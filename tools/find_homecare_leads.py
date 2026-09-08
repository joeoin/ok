#!/usr/bin/env python3
"""
Home care agency prospect scraper.

Pulls home care agencies off Google Maps, then visits each agency's own site to
find the owner's name, public emails, and two intent signals:

  hiring   — a careers page, "now hiring" copy, or a recruiting ATS embedded on
             the site (CareerPlug, Workstream, Apploi, JazzHR, Indeed widgets).
             This is the signal that matters for a caregiver recruiting offer:
             they are trying to staff right now.
  runs_ads — a live Meta Pixel or Google Ads conversion tag, meaning they
             already buy traffic and have a budget line for acquisition.

Both beat the Meta Ad Library, which rate-limits scraping hard.

Output is a CSV. Sort by hiring first, runs_ads second — an agency doing both is
spending money on acquisition AND cannot staff its cases.

Requirements:
    pip install requests beautifulsoup4 playwright
    playwright install chromium --with-deps

Usage:
    # ~1,000 prospects: 42 metros x 25 each. Takes a few hours; resume if it dies.
    python tools/find_homecare_leads.py --cities-file tools/metros.txt --max 25
    python tools/find_homecare_leads.py --cities-file tools/metros.txt --max 25 --resume

    # Single market
    python tools/find_homecare_leads.py --cities "Phoenix, AZ" --max 40
"""

import argparse
import csv
import os
import re
import sys
import time
from urllib.parse import urljoin, urlparse

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit("Missing deps: pip install requests beautifulsoup4")

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

# Pages most likely to name the owner and publish a real address.
SUBPAGES = ["", "/about", "/about-us", "/our-team", "/team", "/contact",
            "/contact-us", "/meet-our-owner", "/our-story", "/leadership",
            "/careers", "/jobs", "/employment", "/apply", "/join-our-team",
            "/caregiver-jobs", "/now-hiring"]

# Recruiting stacks common in home care. CareerPlug in particular is near-ubiquitous.
ATS_PATTERNS = [
    ("careerplug", r"careerplug"), ("workstream", r"workstream\.is|workstream\.us"),
    ("apploi", r"apploi"), ("jazzhr", r"jazzhr|applytojob"),
    ("bamboohr", r"bamboohr"), ("paradox", r"paradox\.ai|olivia\.paradox"),
    ("indeed-widget", r"indeed\.com/(cmp|jobs|hire)|indeedassessments"),
    ("ziprecruiter", r"ziprecruiter"), ("hireology", r"hireology"),
    ("wellsky", r"wellsky"), ("axiscare", r"axiscare"), ("clearcare", r"clearcare"),
]

HIRING_COPY = re.compile(
    r"now hiring|we'?re hiring|join our team|apply now|caregiver jobs|"
    r"hiring caregivers|become a caregiver|open positions|current openings|"
    r"employment opportunities", re.I)

# Scoped (?i:...) so the titles match any casing while the name pattern beside
# them keeps relying on real capitalization to avoid matching sentence text.
TITLE_WORDS = (r"((?i:owner|founder|co-founder|president|ceo|administrator|"
               r"executive director|managing director|director of operations))")

# Junk that shows up in mailto scrapes and is never a person.
EMAIL_JUNK = re.compile(
    r"(sentry|wixpress|example\.|@2x|\.png|\.jpg|\.gif|\.svg|godaddy|"
    r"domain|placeholder|yourname|email@|no-?reply)", re.I)

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def maps_search(query, city, max_results, headless=True):
    """Scrape the Google Maps result rail for one query+city."""
    from playwright.sync_api import sync_playwright

    out = []
    url = f"https://www.google.com/maps/search/{query.replace(' ', '+')}+in+{city.replace(' ', '+')}"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        page = browser.new_page(user_agent=UA)
        page.goto(url, timeout=60000)
        page.wait_for_timeout(4000)

        # Consent interstitial shows in some regions.
        for label in ["Accept all", "Reject all", "I agree"]:
            try:
                page.get_by_role("button", name=label).click(timeout=1500)
                page.wait_for_timeout(1500)
                break
            except Exception:
                pass

        # The rail lazy-loads; scroll it until the count stops growing.
        feed = 'div[role="feed"]'
        try:
            page.wait_for_selector(feed, timeout=15000)
        except Exception:
            browser.close()
            return out

        seen = -1
        while True:
            cards = page.query_selector_all(f'{feed} a[href*="/maps/place/"]')
            if len(cards) >= max_results or len(cards) == seen:
                break
            seen = len(cards)
            page.eval_on_selector(feed, "el => el.scrollTo(0, el.scrollHeight)")
            page.wait_for_timeout(2500)

        for card in page.query_selector_all(f'{feed} a[href*="/maps/place/"]')[:max_results]:
            try:
                card.click()
                page.wait_for_timeout(2800)
                name = None
                h1 = page.query_selector("h1")
                if h1:
                    name = h1.inner_text().strip()

                site = None
                el = page.query_selector('a[data-item-id="authority"]')
                if el:
                    site = el.get_attribute("href")

                phone = None
                el = page.query_selector('button[data-item-id^="phone:tel:"]')
                if el:
                    phone = (el.get_attribute("data-item-id") or "").replace("phone:tel:", "")

                addr = None
                el = page.query_selector('button[data-item-id="address"]')
                if el:
                    addr = el.get_attribute("aria-label", ).replace("Address: ", "") if el.get_attribute("aria-label") else None

                if name:
                    out.append({"agency": name, "website": site, "phone": phone,
                                "address": addr, "city": city})
            except Exception:
                continue

        browser.close()
    return out


def fetch(url, timeout=20):
    try:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=timeout)
        if r.status_code == 200 and "text/html" in r.headers.get("content-type", ""):
            return r.text
    except Exception:
        pass
    return ""


def profile_site(site):
    """Crawl a few pages of one agency site for ad tags, emails, and an owner name."""
    info = {"runs_ads": "", "ad_tech": "", "hiring": "", "hiring_signal": "",
            "emails": "", "owner": "", "owner_title": ""}
    if not site:
        return info

    base = f"{urlparse(site).scheme}://{urlparse(site).netloc}"
    html_all, emails = "", set()

    for path in SUBPAGES:
        html = fetch(urljoin(base, path))
        if not html:
            continue
        html_all += html
        for e in EMAIL_RE.findall(html):
            if not EMAIL_JUNK.search(e):
                emails.add(e.lower())
        time.sleep(0.6)

    if not html_all:
        return info

    tags = []
    if re.search(r"connect\.facebook\.net|fbq\(|facebook\.com/tr", html_all):
        tags.append("meta-pixel")
    aw = set(re.findall(r"AW-\d{9,}", html_all))
    if aw:
        tags.append("google-ads:" + ",".join(sorted(aw)))
    if re.search(r"gtm\.js|GTM-[A-Z0-9]{5,}", html_all):
        tags.append("gtm")
    for extra, pat in [("tiktok", r"analytics\.tiktok\.com"),
                       ("callrail", r"callrail"),
                       ("calltrackingmetrics", r"calltrackingmetrics"),
                       ("leadconnector", r"leadconnector")]:
        if re.search(pat, html_all, re.I):
            tags.append(extra)

    info["ad_tech"] = "; ".join(tags)

    # Hiring intent: an ATS on the page is strong, careers copy alone is weaker.
    hire = [name for name, pat in ATS_PATTERNS if re.search(pat, html_all, re.I)]
    copy_hits = HIRING_COPY.findall(html_all)
    if copy_hits:
        hire.append(f"copy:{copy_hits[0].lower().strip()}")
    info["hiring_signal"] = "; ".join(hire)
    info["hiring"] = "YES" if hire else ""
    # Pixel or an AW- conversion tag means they are actively buying traffic.
    info["runs_ads"] = "YES" if ("meta-pixel" in tags or any(t.startswith("google-ads") for t in tags)) else ""

    # Owner name: look for a capitalized name sitting next to an ownership title.
    text = re.sub(r"\s+", " ", BeautifulSoup(html_all, "html.parser").get_text(" "))
    for pat in [rf"([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)[,\s\u2013-]{{1,4}}{TITLE_WORDS}",
                rf"{TITLE_WORDS}[,\s:\u2013-]{{1,4}}([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)"]:
        m = re.search(pat, text)
        if m:
            groups = [g for g in m.groups() if g]
            name = next((g for g in groups if " " in g), "")
            title = next((g for g in groups if " " not in g or g.lower().startswith("executive")), "")
            info["owner"], info["owner_title"] = name.strip(), title.strip().title()
            break

    # Prefer a personal-looking address over a generic inbox.
    ranked = sorted(emails, key=lambda e: (e.split("@")[0] in
                    ("info", "contact", "hello", "admin", "office", "care", "careers"), e))
    info["emails"] = "; ".join(ranked[:4])
    return info


def main():
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--cities", nargs="+", help='e.g. --cities "Phoenix, AZ" "Mesa, AZ"')
    src.add_argument("--cities-file", help="one metro per line; # comments ignored")
    ap.add_argument("--query", default="home care agency")
    ap.add_argument("--max", type=int, default=25, help="results per city")
    ap.add_argument("--out", default="homecare_leads.csv")
    ap.add_argument("--resume", action="store_true",
                    help="skip agencies already profiled in --out")
    ap.add_argument("--show-browser", action="store_true")
    args = ap.parse_args()

    if args.cities_file:
        with open(args.cities_file) as f:
            cities = [ln.strip() for ln in f
                      if ln.strip() and not ln.startswith("#")]
    else:
        cities = args.cities

    cols = ["agency", "owner", "owner_title", "emails", "phone", "website",
            "hiring", "hiring_signal", "runs_ads", "ad_tech", "address", "city"]

    # Resume: remember what a previous run already profiled.
    done, existing = set(), []
    if args.resume and os.path.exists(args.out):
        with open(args.out, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                existing.append(row)
                key = urlparse(row["website"]).netloc.lower() if row.get("website") else row["agency"].lower()
                done.add(key)
        print(f"[resume] {len(done)} agencies already profiled in {args.out}")

    rows = []
    for city in cities:
        print(f"[maps] {args.query} in {city} ...", flush=True)
        try:
            found = maps_search(args.query, city, args.max, headless=not args.show_browser)
        except Exception as e:
            print(f"       failed ({e}) — moving on", flush=True)
            continue
        print(f"       {len(found)} agencies", flush=True)
        rows.extend(found)

    # De-dupe on domain, falling back to agency name.
    seen, queue = set(done), []
    for r in rows:
        key = urlparse(r["website"]).netloc.lower() if r["website"] else r["agency"].lower()
        if key and key not in seen:
            seen.add(key)
            queue.append(r)

    print(f"\n[sites] profiling {len(queue)} new agencies ...", flush=True)

    def flush_csv(batch):
        with open(args.out, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
            w.writeheader()
            w.writerows(existing + batch)

    for i, r in enumerate(queue, 1):
        try:
            r.update(profile_site(r["website"]))
        except Exception:
            pass
        flags = ("HIRE" if r.get("hiring") else "    ") + ("/ADS" if r.get("runs_ads") else "    ")
        print(f"  {i:>4}/{len(queue)} [{flags}] {r['agency'][:42]:<42} {r.get('owner') or '-'}", flush=True)
        if i % 10 == 0:
            flush_csv(queue[:i])  # checkpoint so a crash costs 10 rows, not the run

    flush_csv(queue)
    allrows = existing + queue
    hiring = sum(1 for r in allrows if r.get("hiring"))
    ads = sum(1 for r in allrows if r.get("runs_ads"))
    both = sum(1 for r in allrows if r.get("hiring") and r.get("runs_ads"))
    named = sum(1 for r in allrows if r.get("owner"))
    emailed = sum(1 for r in allrows if r.get("emails"))

    print(f"\nWrote {args.out} — {len(allrows)} agencies")
    print(f"  {hiring} actively hiring, {ads} running ads, {both} doing both")
    print(f"  {named} with an owner name, {emailed} with at least one email")
    print("\nWork the 'both' rows first: they have an acquisition budget AND cannot staff their cases.")


if __name__ == "__main__":
    main()
