#!/usr/bin/env python3
"""
PublicSurplus deal-finder agent.

Scrapes listings closing within 72 hours near zip 85001 (100mi radius),
looks up eBay sold comps, and surfaces only deals with profit_ratio >= 1.8x.

Usage:
    python tools/search_auctions.py
    python tools/search_auctions.py --zip 85260 --radius 100 --hours 24 --min-ratio 1.8 --max 10
"""

import argparse
import json
import os
import re
import sys
import time

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit("Missing deps: pip install requests beautifulsoup4")

# Load .env if present
_env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
if os.path.exists(_env_path):
    with open(_env_path) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _v = _line.split("=", 1)
                os.environ.setdefault(_k.strip(), _v.strip())


# ── PublicSurplus scraper ──────────────────────────────────────────────────────

def scrape_publicsurplus(zip_code: str, radius: int, hours: int, max_listings: int) -> list[dict]:
    """Scrape PublicSurplus for listings closing within `hours` hours near zip_code."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit("Missing dep: pip install playwright && python -m playwright install chromium")

    listings = []
    seen = set()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Search all categories, sorted by time left, closing within hours
        url = (
            "https://www.publicsurplus.com/sms/browse/search"
            f"?posting=y&page=1&sortBy=timeLeft"
            f"&endHours={hours}&startHours=-1"
            f"&lowerPrice=&higherPrice="
            f"&milesLocation={radius}&zipCode={zip_code}"
            f"&region=&search=Search"
        )
        print(f"Scraping PublicSurplus: {url}", file=sys.stderr)
        page.goto(url, wait_until="networkidle", timeout=30000)
        page.wait_for_timeout(2000)

        items = page.eval_on_selector_all(
            "a[href*='/auction/view']",
            """els => els.map(e => {
                const card = e.closest('.auction-item, .ps-card, .card, li, tr') || e.parentElement;
                const cardText = card ? card.innerText : '';
                const priceMatch = cardText.match(/\\$[\\d,]+(?:\\.\\d{2})?/);
                const lines = cardText.split('\\n').map(l => l.trim()).filter(Boolean);
                return {
                    href: e.getAttribute('href'),
                    text: (e.innerText || e.textContent || '').trim(),
                    price: priceMatch ? priceMatch[0] : '',
                    card_lines: lines
                };
            })"""
        )

        browser.close()

    for item in items:
        href = item.get("href", "")
        if not href or "/auction/view" not in href:
            continue
        full_url = "https://www.publicsurplus.com" + href if not href.startswith("http") else href
        auc_id = re.search(r"auc=(\d+)", full_url)
        key = auc_id.group(1) if auc_id else full_url
        if key in seen:
            continue
        seen.add(key)

        card_lines = item.get("card_lines", [])
        card_text = " | ".join(card_lines[:8])

        # Extract title from card
        name_match = re.search(r"#\d+ - (.+?)(?:\s*\||\s*$)", card_text)
        title = name_match.group(1).strip().title() if name_match else item.get("text", "").strip()
        if not title or len(title) < 3:
            continue

        # Extract price
        price_str = item.get("price", "")
        price_match = re.search(r"\$([\d,]+(?:\.\d{2})?)", price_str)
        price = float(price_match.group(1).replace(",", "")) if price_match else 0.0

        # Extract time remaining
        time_match = re.search(r"(\d+)\s*(?:hour|hr|day|min)", card_text, re.I)
        time_left = ""
        for line in card_lines:
            if re.search(r"hour|day|min", line, re.I) and re.search(r"\d+", line):
                time_left = line.strip()
                break

        # Extract location/category from card
        location = ""
        for line in card_lines:
            if re.match(r"^[A-Z]{2}$", line.strip()):
                location = line.strip()
                break

        # Extract number of bids
        bids = 0
        for line in card_lines:
            bm = re.search(r"(\d+)\s*bid", line, re.I)
            if bm:
                bids = int(bm.group(1))
                break

        listings.append({
            "id": key,
            "title": title,
            "url": full_url,
            "price": price,
            "price_str": price_str or f"${price:.2f}",
            "time_left": time_left,
            "bids": bids,
            "location": location,
            "card_text": card_text,
        })

        if len(listings) >= max_listings:
            break

    print(f"Found {len(listings)} listings closing within {hours}h near {zip_code}", file=sys.stderr)

    # Deduplicate by normalized title
    seen_titles = set()
    unique = []
    for l in listings:
        key = re.sub(r"\W+", " ", l["title"].lower()).strip()
        if key not in seen_titles:
            seen_titles.add(key)
            unique.append(l)
    print(f"After dedup: {len(unique)} unique listings", file=sys.stderr)
    return unique


# ── Facebook Marketplace price lookup ─────────────────────────────────────────

def get_fb_comps(title: str) -> dict:
    """Search Facebook Marketplace for current listing prices near Phoenix AZ."""
    from playwright.sync_api import sync_playwright
    from urllib.parse import quote_plus

    words = [w for w in re.split(r"\W+", title) if len(w) > 2][:5]
    query = " ".join(words)
    if not query:
        return {"prices": [], "avg": 0, "count": 0, "query": query}

    email = os.environ.get("FB_EMAIL", "")
    password = os.environ.get("FB_PASSWORD", "")
    if not email or not password:
        print("FB credentials not set in .env", file=sys.stderr)
        return {"prices": [], "avg": 0, "count": 0, "query": query}

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            ctx = browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            )
            page = ctx.new_page()

            # Login
            page.goto("https://www.facebook.com/login", wait_until="load", timeout=30000)
            page.wait_for_selector("input[name='email']", timeout=10000)
            page.fill("input[name='email']", email)
            page.fill("input[name='pass']", password)
            page.press("input[name='pass']", "Enter")
            page.wait_for_timeout(5000)

            if "login" in page.url or "checkpoint" in page.url:
                print(f"FB login failed — still on: {page.url}", file=sys.stderr)
                browser.close()
                return {"prices": [], "avg": 0, "count": 0, "query": query}
            print(f"FB logged in OK — searching: {query}", file=sys.stderr)

            # Search Marketplace
            url = f"https://www.facebook.com/marketplace/phoenix/search?query={quote_plus(query)}&exact=false"
            page.goto(url, wait_until="load", timeout=30000)
            page.wait_for_timeout(3000)

            prices_raw = page.eval_on_selector_all(
                "span[dir='auto']",
                "els => els.map(e => e.innerText.trim()).filter(t => t.startsWith('$'))"
            )
            browser.close()

        prices = []
        for text in prices_raw:
            m = re.search(r"\$([\d,]+(?:\.\d{2})?)", text)
            if m:
                try:
                    val = float(m.group(1).replace(",", ""))
                    if 0.99 < val < 50000:
                        prices.append(val)
                except ValueError:
                    pass

        if not prices:
            return {"prices": [], "avg": 0, "count": 0, "query": query}

        prices.sort()
        avg = sum(prices) / len(prices)
        median = prices[len(prices) // 2]
        return {
            "prices": prices,
            "avg": round(avg, 2),
            "median": round(median, 2),
            "low": prices[0],
            "high": prices[-1],
            "count": len(prices),
            "query": query,
            "source": "facebook_marketplace",
        }
    except Exception as e:
        print(f"FB lookup failed for '{title}': {e}", file=sys.stderr)
        return {"prices": [], "avg": 0, "count": 0, "query": query}


# ── Listing detail scraper ────────────────────────────────────────────────────

def get_listing_details(url: str) -> dict:
    """Visit a PublicSurplus listing page and extract full item description."""
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(url, wait_until="load", timeout=30000)
            page.wait_for_timeout(1500)

            details = page.eval_on_selector_all("*", """els => {
                const get = sel => {
                    const el = document.querySelector(sel);
                    return el ? el.innerText.trim() : '';
                };
                return {
                    title: get('h1, h2, .auction-title, [class*="title"]'),
                    description: get('.auction-description, [class*="desc"], #description, .item-desc'),
                    condition: get('[class*="condition"], [class*="status"]'),
                    location: get('[class*="location"], [class*="pickup"], [class*="agency"]'),
                    photos: document.querySelectorAll('img[src*="auction"], img[src*="photo"], img[src*="img"]').length
                };
            }""")
            browser.close()
            return details[0] if details else {}
    except Exception as e:
        return {}



def analyze_deals(listings: list[dict], min_ratio: float, min_profit: float) -> list[dict]:
    deals = []
    total = len(listings)
    for i, listing in enumerate(listings):
        price = listing["price"]
        if price <= 0:
            continue

        # Get full listing details to identify the specific item
        print(f"[{i+1}/{total}] Getting listing details: {listing['title']}", file=sys.stderr)
        details = get_listing_details(listing["url"])

        # Use full title from listing page if available
        full_title = details.get("title", "") or listing["title"]
        if len(full_title) < 4:
            full_title = listing["title"]
        listing["title"] = full_title
        listing["description"] = details.get("description", "")
        listing["condition"] = details.get("condition", "")
        listing["pickup_location"] = details.get("location", listing.get("location", "AZ"))
        listing["photo_count"] = details.get("photos", 0)

        print(f"[{i+1}/{total}] Checking FB Marketplace: {full_title}", file=sys.stderr)
        comps = get_fb_comps(full_title)

        if comps["count"] == 0:
            continue

        # Use conservative estimate: lower of avg and median
        resale = min(comps["avg"], comps.get("median", comps["avg"]))
        risk_flags = []
        card_lower = (listing.get("card_text", "") + " " + listing.get("description", "")).lower()
        if any(w in card_lower for w in ["as-is", "as is", "untested", "for parts", "unknown condition", "non-working"]):
            resale *= 0.70
            risk_flags.append("AS-IS / Condition risk (-30% applied)")

        profit_ratio = resale / price if price > 0 else 0
        est_profit = resale - price

        # Must meet BOTH ratio AND minimum dollar profit
        if profit_ratio < min_ratio or est_profit < min_profit:
            continue

        confidence = "HIGH" if comps["count"] >= 5 else ("MED" if comps["count"] >= 3 else "LOW")
        est_profit = resale - price

        deals.append({
            **listing,
            "ebay_avg": comps["avg"],
            "ebay_median": comps.get("median", 0),
            "ebay_low": comps.get("low", 0),
            "ebay_high": comps.get("high", 0),
            "ebay_count": comps["count"],
            "ebay_query": comps["query"],
            "resale_estimate": round(resale, 2),
            "profit_ratio": round(profit_ratio, 2),
            "est_profit": round(est_profit, 2),
            "confidence": confidence,
            "risk_flags": risk_flags,
        })

    deals.sort(key=lambda x: x["profit_ratio"], reverse=True)
    return deals


# ── Output formatting ──────────────────────────────────────────────────────────

def format_deals(deals: list[dict]) -> str:
    if not deals:
        return "No deals found meeting the 1.8x profit ratio threshold.\n"

    lines = []
    for i, d in enumerate(deals, 1):
        risk_str = ", ".join(d["risk_flags"]) if d["risk_flags"] else "None"
        recommend = "BUY" if d["profit_ratio"] >= 2.5 and d["confidence"] != "LOW" else (
                    "WATCH" if d["profit_ratio"] >= 1.8 else "SKIP")
        lines.append(f"""
--- DEAL #{i} ---
TITLE:           {d['title']}
URL:             {d['url']}
CURRENT PRICE:   {d['price_str']}
TIME REMAINING:  {d['time_left']}
BIDS:            {d['bids']}
LOCATION:        {d.get('location', 'AZ')}

RESALE COMPS (FB Marketplace Phoenix — "{d['ebay_query']}"):
  Avg:    ${d['ebay_avg']:,.0f}
  Median: ${d['ebay_median']:,.0f}
  Range:  ${d['ebay_low']:,.0f} – ${d['ebay_high']:,.0f}
  Comps:  {d['ebay_count']} active listings
  Est. quick-sale value: ${d['resale_estimate']:,.0f}

PROFIT RATIO:    {d['profit_ratio']:.1f}x
EST. PROFIT:     ${d['est_profit']:,.0f}
CONFIDENCE:      {d['confidence']}
RISK FLAGS:      {risk_str}
RECOMMENDATION:  {recommend}
""")

    # Summary table
    lines.append("\n" + "="*80)
    lines.append("SUMMARY TABLE")
    lines.append("="*80)
    lines.append(f"{'Rank':<5} {'Item':<35} {'Price':>8} {'Resale':>8} {'Ratio':>7} {'Time Left':<20} {'Risk'}")
    lines.append("-"*90)
    for i, d in enumerate(deals, 1):
        risk = "⚠ " + d["risk_flags"][0][:20] if d["risk_flags"] else "Low"
        lines.append(
            f"{i:<5} {d['title'][:34]:<35} {d['price_str']:>8} "
            f"${d['resale_estimate']:>7,.0f} {d['profit_ratio']:>6.1f}x  {d['time_left'][:18]:<20} {risk}"
        )

    # Top pick
    if deals:
        top = deals[0]
        lines.append(f"\nTOP PICK: {top['title']}")
        lines.append(f"  Bid ${top['price']:.0f}, resells for ~${top['resale_estimate']:.0f} — {top['profit_ratio']:.1f}x return. {top['url']}")

    return "\n".join(lines)


# ── CLI ────────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--zip",       default="85001", help="ZIP code (default: 85001 Phoenix AZ)")
    p.add_argument("--radius",    type=int, default=100)
    p.add_argument("--hours",     type=int, default=72, help="Max hours until closing (default 72)")
    p.add_argument("--min-ratio",  type=float, default=1.8,  help="Min profit ratio (default 1.8)")
    p.add_argument("--min-profit", type=float, default=100.0, help="Min dollar profit (default $100)")
    p.add_argument("--max",        type=int,   default=50,   help="Max listings to scrape")
    p.add_argument("--json",      action="store_true", help="Output raw JSON instead of formatted text")
    args = p.parse_args()

    listings = scrape_publicsurplus(args.zip, args.radius, args.hours, args.max)
    if not listings:
        print("No listings found. Check your zip/radius/hours settings.")
        sys.exit(0)

    print(f"\nAnalyzing {len(listings)} listings for {args.min_ratio}x + ${args.min_profit:.0f} min profit...\n", file=sys.stderr)
    deals = analyze_deals(listings, args.min_ratio, args.min_profit)

    if args.json:
        print(json.dumps(deals, indent=2))
    else:
        print(format_deals(deals))


if __name__ == "__main__":
    main()
