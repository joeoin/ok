#!/usr/bin/env python3
"""Search PublicSurplus and Iron Planet for auction listings.

Usage:
    python tools/search_auctions.py --state AZ --zip 85001 --radius 100 --keywords "generator" --max 5
    python tools/search_auctions.py --state AZ --zip 85001 --radius 100 --category "Tools & Equipment" --max 5

Output: JSON array of {url, title, site} to stdout.
Errors go to stderr; exits 0 with partial results if one site fails.
"""

import argparse
import json
import re
import sys
import time

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print(json.dumps([]))
    print("Missing deps: pip install requests beautifulsoup4", file=sys.stderr)
    sys.exit(1)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


# ── PublicSurplus (Playwright) ─────────────────────────────────────────────────

def search_publicsurplus(keywords: str, zip_code: str, radius: int, max_results: int) -> list[dict]:
    """Search PublicSurplus using Playwright (results are JS-rendered)."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("Playwright not installed. Run: pip install playwright && python -m playwright install chromium", file=sys.stderr)
        return []

    results = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.set_extra_http_headers({"Accept-Language": "en-US,en;q=0.9"})

            url = (
                "https://www.publicsurplus.com/sms/browse/search"
                f"?posting=y&page=1&sortBy=timeLeft&keyWord={requests.utils.quote(keywords)}"
                f"&catId=&endHours=-1&startHours=-1&lowerPrice=&higherPrice="
                f"&milesLocation={radius}&zipCode={zip_code}&region=&search=Search"
            )
            page.goto(url, wait_until="networkidle", timeout=30000)

            # Wait for auction rows to appear
            try:
                page.wait_for_selector("a[href*='auctionId'], a[href*='/auction/view']", timeout=10000)
            except Exception:
                pass  # No results or timeout — fall through to link scan

            content = page.content()
            browser.close()

        soup = BeautifulSoup(content, "html.parser")
        seen = set()
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if "/auction/view" in href or "auctionId=" in href:
                if not href.startswith("http"):
                    href = "https://www.publicsurplus.com" + href
                if href not in seen:
                    seen.add(href)
                    title = a.get_text(strip=True)
                    if len(title) > 5:
                        results.append({"url": href, "title": title, "site": "publicsurplus"})
                        if len(results) >= max_results:
                            break

    except Exception as e:
        print(f"PublicSurplus error: {e}", file=sys.stderr)

    if not results:
        print(f"PublicSurplus: 0 results for '{keywords}' near {zip_code}", file=sys.stderr)
    return results


# ── Iron Planet ────────────────────────────────────────────────────────────────

_IP_CATEGORY_MAP = [
    (["generator", "power equipment", "genset"],         "/Generators+and+Power+Equipment"),
    (["truck", "trailer", "pickup"],                      "/Trucks+%26+Trailers"),
    (["forklift", "warehouse", "pallet"],                 "/Forklifts+and+Warehouse+Equipment"),
    (["mower", "tractor", "farm", "lawn", "garden"],      "/Agriculture"),
    (["crane"],                                            "/Cranes"),
    (["excavator", "dozer", "loader", "skid steer"],      "/Construction"),
]

_IP_SKIP = {"laptop", "computer", "notebook", "phone", "tablet",
             "furniture", "chair", "desk", "couch", "sofa",
             "guitar", "piano", "violin", "drum",
             "treadmill", "dumbbell", "weights"}

_ITEM_RE = re.compile(r"^/for-sale/[^/?#]+/\d+")


def _ip_parse_items(soup, max_results, filter_words=None):
    results = []
    seen = set()
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if not _ITEM_RE.match(href):
            continue
        clean = "https://www.ironplanet.com" + href.split("?")[0]
        if clean in seen:
            continue
        seen.add(clean)

        title = a.get_text(strip=True)
        if len(title) < 6:
            slug = href.split("?")[0].rsplit("/", 2)[-2]
            title = re.sub(r"-?%28.*?%29-?", " ", slug).replace("-", " ").strip()
        if len(title) <= 5:
            continue

        if filter_words and not any(w in title.lower() for w in filter_words):
            continue

        results.append({"url": clean, "title": title, "site": "ironplanet"})
        if len(results) >= max_results:
            break
    return results


def search_ironplanet(keywords: str, max_results: int) -> list[dict]:
    kw_split = set(re.split(r"\W+", keywords.lower()))
    if kw_split & _IP_SKIP:
        return []

    kw = keywords.lower()
    kw_words = [w for w in re.split(r"\W+", kw) if len(w) > 2]

    category_path = None
    for terms, path in _IP_CATEGORY_MAP:
        if any(t in kw for t in terms):
            category_path = path
            break

    if category_path:
        url = "https://www.ironplanet.com" + category_path
        try:
            r = requests.get(url, headers=HEADERS, timeout=20)
            r.raise_for_status()
            results = _ip_parse_items(BeautifulSoup(r.text, "html.parser"), max_results)
            if results:
                return results
        except Exception as e:
            print(f"Iron Planet category error: {e}", file=sys.stderr)

    try:
        r = requests.get(
            "https://www.ironplanet.com/jsp/s/search.ips",
            params={"kw": keywords},
            headers=HEADERS,
            timeout=20,
        )
        r.raise_for_status()
        results = _ip_parse_items(
            BeautifulSoup(r.text, "html.parser"),
            max_results,
            filter_words=kw_words,
        )
        if results:
            return results
    except Exception as e:
        print(f"Iron Planet search error: {e}", file=sys.stderr)

    print(f"Iron Planet: 0 results for '{keywords}'", file=sys.stderr)
    return []


# ── CLI ────────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--state", required=True, help="Two-letter state code, e.g. AZ")
    p.add_argument("--zip", default="85001", help="ZIP code for PublicSurplus radius search")
    p.add_argument("--radius", type=int, default=100, help="Search radius in miles")
    p.add_argument("--category", default="", help="Item category")
    p.add_argument("--keywords", default="", help="Search keywords (overrides --category)")
    p.add_argument("--max", type=int, default=5, help="Max results per site")
    args = p.parse_args()

    term = args.keywords or args.category
    if not term:
        print("Provide --keywords or --category", file=sys.stderr)
        sys.exit(1)

    results = []
    results += search_publicsurplus(term, args.zip, args.radius, args.max)
    results += search_ironplanet(term, args.max)

    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
