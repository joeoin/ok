#!/usr/bin/env python3
"""Search PublicSurplus, BidSpotter, and Iron Planet for auction listings.

Usage:
    python tools/search_auctions.py --state AZ --keywords "generator" --max 3
    python tools/search_auctions.py --state AZ --category "Tools & Equipment" --max 3

Output: JSON array of {url, title, site} to stdout.
Errors go to stderr; script exits 0 with partial results if one site fails.
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
    """Search PublicSurplus using the /sms/browse/search endpoint with zip+radius filter."""
    results = []
    try:
        r = requests.get(
            "https://www.publicsurplus.com/sms/browse/search",
            params={
                "posting": "y",
                "page": "1",
                "sortBy": "timeLeft",
                "keyWord": keywords,
                "catId": "",
                "endHours": "-1",
                "startHours": "-1",
                "lowerPrice": "",
                "higherPrice": "",
                "milesLocation": str(radius),
                "zipCode": zip_code,
                "region": "",
                "search": "Search",
            },
            headers=HEADERS,
            timeout=20,
        )
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")

        seen = set()
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if "/auction/view" in href:
                if not href.startswith("http"):
                    href = "https://www.publicsurplus.com" + href
                if href not in seen:
                    seen.add(href)
                    title = a.get_text(strip=True)
                    if len(title) > 5:
                        results.append({"url": href, "title": title, "site": "publicsurplus"})
                        if len(results) >= max_results:
                            break

        if not results:
            print(f"PublicSurplus: 0 results for '{keywords}' near {zip_code}", file=sys.stderr)
    except Exception as e:
        print(f"PublicSurplus search error: {e}", file=sys.stderr)
    return results


# ── BidSpotter ─────────────────────────────────────────────────────────────────

def search_bidspotter(keywords: str, max_results: int) -> list[dict]:
    """Search BidSpotter in two steps.

    Step 1: keyword search returns catalog-level pages.
    Step 2: fetch each catalog page and extract individual lot links.

    Lot URL format (from live observation):
      /en-us/auction-catalogues/{auctioneer}/catalogue-id-{id}/{lotNum}/{title}
    Not /lots/ — just additional path segments after the catalog ID.
    """
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

        # Catalog links: exactly /en-us/auction-catalogues/{auctioneer}/{catalogue-id}
        # (no further path segments, no query string)
        catalog_re = re.compile(r"^/en-us/auction-catalogues/[^/?#]+/[^/?#]+$")
        catalog_links = []
        seen_catalogs = set()
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if catalog_re.match(href) and href not in seen_catalogs:
                full = "https://www.bidspotter.com" + href
                seen_catalogs.add(href)
                catalog_links.append(full)
                if len(catalog_links) >= 3:
                    break

        if not catalog_links:
            print(f"BidSpotter: no catalogs found for '{keywords}'", file=sys.stderr)
            return results

        # Step 2: visit each catalog and extract lot links
        seen_lots = set()
        for cat_url in catalog_links:
            if len(results) >= max_results:
                break
            try:
                time.sleep(0.5)
                cr = requests.get(cat_url, headers=HEADERS, timeout=20)
                cr.raise_for_status()
                csoup = BeautifulSoup(cr.text, "html.parser")

                # Lot URLs: /en-us/auction-catalogues/{auctioneer}/{catalogue-id}/{numeric-lot-id}/{title}
                # The segment immediately after the catalogue-id must be numeric — this excludes
                # terms-and-conditions, search-filter, register, description, etc.
                cat_path = cat_url.replace("https://www.bidspotter.com", "")
                lot_re = re.compile(r"^" + re.escape(cat_path) + r"/\d+/")

                for a in csoup.find_all("a", href=True):
                    href = a["href"]
                    is_lot = lot_re.match(href) or "/lots/" in href
                    if is_lot:
                        if not href.startswith("http"):
                            href = "https://www.bidspotter.com" + href
                        if href not in seen_lots:
                            seen_lots.add(href)
                            title = a.get_text(strip=True)
                            if len(title) > 5:
                                results.append({"url": href, "title": title, "site": "bidspotter"})
                                if len(results) >= max_results:
                                    break
            except Exception as e:
                print(f"BidSpotter catalog fetch error ({cat_url}): {e}", file=sys.stderr)

        if not results:
            print(
                f"BidSpotter: 0 lots found for '{keywords}' "
                f"(catalog pages may be JavaScript-rendered)",
                file=sys.stderr,
            )
    except Exception as e:
        print(f"BidSpotter search error: {e}", file=sys.stderr)
    return results


# ── Iron Planet ────────────────────────────────────────────────────────────────

def search_ironplanet(keywords: str, max_results: int) -> list[dict]:
    """Search Iron Planet via keyword search.

    Item URL format confirmed from live HTML:
      /for-sale/{Category-Year-Brand-Description-State}/{itemId}?...
    """
    results = []
    try:
        r = requests.get(
            "https://www.ironplanet.com/jsp/s/search.ips",
            params={"kw": keywords},
            headers=HEADERS,
            timeout=20,
        )
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")

        item_re = re.compile(r"^/for-sale/[^/?#]+/\d+")
        seen = set()
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if not item_re.match(href):
                continue
            # Strip query string for a clean canonical URL
            clean = "https://www.ironplanet.com" + href.split("?")[0]
            if clean in seen:
                continue
            seen.add(clean)

            title = a.get_text(strip=True)
            # Fallback: build title from URL slug when anchor text is empty/icon-only
            if len(title) < 6:
                slug = href.split("?")[0].rsplit("/", 2)[-2]
                title = re.sub(r"-%28.*?%29", "", slug).replace("-", " ").strip()

            if len(title) > 5:
                results.append({"url": clean, "title": title, "site": "ironplanet"})
                if len(results) >= max_results:
                    break

        if not results:
            print(f"Iron Planet: 0 results for '{keywords}'", file=sys.stderr)
    except Exception as e:
        print(f"Iron Planet search error: {e}", file=sys.stderr)
    return results


# ── CLI ────────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--state", required=True, help="Two-letter state code, e.g. AZ")
    p.add_argument("--zip", default="85001", help="ZIP code for PublicSurplus location filter")
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
