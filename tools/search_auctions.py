#!/usr/bin/env python3
"""Search PublicSurplus, BidSpotter, and Iron Planet for auction listings.

Usage:
    python tools/search_auctions.py --state AZ --zip 85001 --radius 100 --keywords "generator" --max 3
    python tools/search_auctions.py --state AZ --zip 85001 --radius 100 --category "Tools & Equipment" --max 3

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


# ── PublicSurplus ──────────────────────────────────────────────────────────────

def search_publicsurplus(keywords: str, zip_code: str, radius: int, max_results: int) -> list[dict]:
    """Search PublicSurplus via zip+radius keyword search (original working endpoint)."""
    results = []
    try:
        r = requests.get(
            "https://www.publicsurplus.com/sms/browse/search",
            params={
                "posting": "y", "page": "1", "sortBy": "timeLeft",
                "keyWord": keywords, "catId": "",
                "endHours": "-1", "startHours": "-1",
                "lowerPrice": "", "higherPrice": "",
                "milesLocation": str(radius), "zipCode": zip_code,
                "region": "", "search": "Search",
            },
            headers=HEADERS,
            timeout=20,
        )
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
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
        print(f"PublicSurplus search error: {e}", file=sys.stderr)

    if not results:
        print(f"PublicSurplus: 0 results for '{keywords}' near {zip_code}", file=sys.stderr)
    return results


# ── BidSpotter ─────────────────────────────────────────────────────────────────

def search_bidspotter(keywords: str, max_results: int) -> list[dict]:
    """Search BidSpotter: get catalog list, then scrape lot links from each catalog."""
    results = []
    try:
        r = requests.get(
            "https://www.bidspotter.com/en-us/auction-catalogues",
            params={"q": keywords, "pageNo": 1},
            headers=HEADERS,
            timeout=20,
        )
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")

        catalog_re = re.compile(r"^/en-us/auction-catalogues/[^/?#]+/[^/?#]+$")
        catalog_links = []
        seen_catalogs = set()
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if catalog_re.match(href) and href not in seen_catalogs:
                seen_catalogs.add(href)
                catalog_links.append("https://www.bidspotter.com" + href)
                if len(catalog_links) >= 3:
                    break

        if not catalog_links:
            print(f"BidSpotter: no catalogs found for '{keywords}'", file=sys.stderr)
            return results

        seen_lots = set()
        for cat_url in catalog_links:
            if len(results) >= max_results:
                break
            try:
                time.sleep(0.5)
                cr = requests.get(cat_url, headers=HEADERS, timeout=20)
                cr.raise_for_status()
                csoup = BeautifulSoup(cr.text, "html.parser")
                cat_path = cat_url.replace("https://www.bidspotter.com", "")
                lot_re = re.compile(r"^" + re.escape(cat_path) + r"/\d+/")
                for a in csoup.find_all("a", href=True):
                    href = a["href"]
                    if (lot_re.match(href) or "/lots/" in href) and href not in seen_lots:
                        if not href.startswith("http"):
                            href = "https://www.bidspotter.com" + href
                        seen_lots.add(href)
                        title = a.get_text(strip=True)
                        if len(title) > 5:
                            results.append({"url": href, "title": title, "site": "bidspotter"})
                            if len(results) >= max_results:
                                break
            except Exception as e:
                print(f"BidSpotter catalog error ({cat_url}): {e}", file=sys.stderr)

        if not results:
            print(f"BidSpotter: 0 lots found for '{keywords}'", file=sys.stderr)
    except Exception as e:
        print(f"BidSpotter search error: {e}", file=sys.stderr)
    return results


# ── Iron Planet ────────────────────────────────────────────────────────────────

# Category browse URLs whose pages load items in static HTML.
# Any keyword not in this map falls back to keyword search.
_IP_CATEGORY_MAP = [
    (["generator", "power equipment", "genset"],         "/Generators+and+Power+Equipment"),
    (["truck", "trailer", "pickup"],                      "/Trucks+%26+Trailers"),
    (["forklift", "warehouse", "pallet"],                 "/Forklifts+and+Warehouse+Equipment"),
    (["mower", "tractor", "farm", "lawn", "garden"],      "/Agriculture"),
    (["crane"],                                            "/Cranes"),
    (["excavator", "dozer", "loader", "skid steer"],      "/Construction"),
]

# Keywords that don't exist on Iron Planet — skip entirely
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
    """Search Iron Planet.

    Strategy:
    1. If keyword maps to a known category, use that category browse page
       (these load items in static HTML — confirmed from live debug).
    2. Otherwise fall back to keyword search on search.ips with a relevance
       filter to drop the 2 always-present featured Arizona items.
    """
    kw_split = set(re.split(r"\W+", keywords.lower()))
    if kw_split & _IP_SKIP:
        return []  # Iron Planet doesn't carry these

    kw = keywords.lower()
    kw_words = [w for w in re.split(r"\W+", kw) if len(w) > 2]

    # Try specific category browse first
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

    # Fallback: keyword search with relevance filter
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
    p.add_argument("--zip", default="85001", help="ZIP code for PublicSurplus")
    p.add_argument("--radius", type=int, default=100, help="Search radius in miles")
    p.add_argument("--category", default="", help="Item category")
    p.add_argument("--keywords", default="", help="Search keywords (overrides --category)")
    p.add_argument("--max", type=int, default=3, help="Max results per site")
    args = p.parse_args()

    term = args.keywords or args.category
    if not term:
        print("Provide --keywords or --category", file=sys.stderr)
        sys.exit(1)

    results = []
    results += search_publicsurplus(term, args.zip, args.radius, args.max)
    time.sleep(0.5)
    results += search_bidspotter(term, args.max)
    time.sleep(0.5)
    results += search_ironplanet(term, args.max)

    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
