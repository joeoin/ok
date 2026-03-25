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

# Headers that trigger AJAX/partial responses on Prototype.js sites
XHR_HEADERS = {
    **HEADERS,
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "text/html, */*; q=0.01",
}


# ── PublicSurplus ──────────────────────────────────────────────────────────────

def search_publicsurplus(keywords: str, state: str, max_results: int) -> list[dict]:
    """Search PublicSurplus.

    Their search results are JavaScript-rendered. Strategy:
    1. POST with XHR headers (Prototype.js AJAX pattern — may return HTML fragment)
    2. GET with XHR headers
    3. Plain GET — scan ALL hrefs for any pattern containing a numeric auction ID
    """
    results = []
    base_url = f"https://www.publicsurplus.com/sms/all,{state.lower()}/browse/search"
    params = {"keyWord": keywords, "sortBy": "timeLeft", "page": "1", "posting": "y"}

    soup = None
    for method, extra_headers in [
        ("POST", {**XHR_HEADERS, "Content-Type": "application/x-www-form-urlencoded",
                  "Referer": "https://www.publicsurplus.com/sms/browse/search"}),
        ("GET",  XHR_HEADERS),
        ("GET",  HEADERS),
    ]:
        try:
            if method == "POST":
                r = requests.post(base_url, data=params, headers=extra_headers, timeout=20)
            else:
                r = requests.get(base_url, params=params, headers=extra_headers, timeout=20)
            r.raise_for_status()

            # If server returned JSON, parse it
            if "json" in r.headers.get("content-type", ""):
                try:
                    data = r.json()
                    items = (
                        data.get("auctions") or data.get("items") or
                        data.get("results") or (data if isinstance(data, list) else [])
                    )
                    for item in items:
                        link = item.get("url") or item.get("link") or item.get("auctionUrl", "")
                        title = (
                            item.get("title") or item.get("name") or
                            item.get("description", "")
                        )
                        if link and title:
                            if not link.startswith("http"):
                                link = "https://www.publicsurplus.com" + link
                            results.append({"url": link, "title": title, "site": "publicsurplus"})
                            if len(results) >= max_results:
                                break
                    if results:
                        return results
                except Exception:
                    pass

            soup = BeautifulSoup(r.text, "html.parser")
            # Check if this response already has auction links; if so stop retrying
            if any(
                "auctionId=" in a["href"] or "/auction/view" in a["href"]
                for a in soup.find_all("a", href=True)
            ):
                break
        except Exception as e:
            print(f"PublicSurplus attempt ({method}) error: {e}", file=sys.stderr)

    if soup:
        seen = set()
        # Auction link patterns observed in the wild:
        #   /sms/auction/view?auctionId=12345
        #   /sms/all,az/auction/view?auctionId=12345
        #   /sms/browse/auctionView?id=12345
        # Broadest safe match: any PS path that contains "auctionId=" or "/auction/view"
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if "auctionId=" in href or "/auction/view" in href:
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
        print(
            f"PublicSurplus: 0 results for '{keywords}' in {state} "
            f"(listings are JavaScript-rendered; XHR approach may not be sufficient)",
            file=sys.stderr,
        )
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

                # Derive catalog path to find deeper links (lot pages)
                cat_path = cat_url.replace("https://www.bidspotter.com", "")

                for a in csoup.find_all("a", href=True):
                    href = a["href"]
                    is_lot = (
                        # Lot is any path that starts with the catalog path + more segments
                        (href.startswith(cat_path + "/") and "search-filter" not in href)
                        # Or explicit /lots/ pattern (future-proof)
                        or "/lots/" in href
                    )
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
    p.add_argument("--category", default="", help="Item category")
    p.add_argument("--keywords", default="", help="Search keywords (overrides --category)")
    p.add_argument("--max", type=int, default=3, help="Max results per site")
    args = p.parse_args()

    term = args.keywords or args.category
    if not term:
        print("Provide --keywords or --category", file=sys.stderr)
        sys.exit(1)

    results = []
    results += search_publicsurplus(term, args.state, args.max)
    time.sleep(0.5)
    results += search_bidspotter(term, args.max)
    time.sleep(0.5)
    results += search_ironplanet(term, args.max)

    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
