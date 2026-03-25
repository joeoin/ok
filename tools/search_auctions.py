#!/usr/bin/env python3
"""Search PublicSurplus, BidSpotter, and Iron Planet for auction listings.

Usage:
    python tools/search_auctions.py --state AZ --category "Tools & Equipment" --max 3
    python tools/search_auctions.py --state AZ --keywords "generator" --max 3

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
}


def search_publicsurplus(state: str, keywords: str, max_results: int) -> list[dict]:
    results = []
    try:
        r = requests.get(
            "https://www.publicsurplus.com/sms/browse/home",
            params={
                "ac": "1",
                "fn": "search",
                "searchstate": state,
                "searchterm": keywords,
                "searchdist": "500",
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
            print(f"PublicSurplus: 0 results for '{keywords}' in {state}", file=sys.stderr)
    except Exception as e:
        print(f"PublicSurplus search error: {e}", file=sys.stderr)
    return results


def search_bidspotter(keywords: str, max_results: int) -> list[dict]:
    """Search BidSpotter for individual auction lots."""
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

        seen = set()
        # BidSpotter lot URLs contain /lots/ in the path
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if "/lots/" in href:
                if not href.startswith("http"):
                    href = "https://www.bidspotter.com" + href
                if href not in seen:
                    seen.add(href)
                    title = a.get_text(strip=True)
                    if len(title) > 5:
                        results.append({"url": href, "title": title, "site": "bidspotter"})
                        if len(results) >= max_results:
                            break

        if not results:
            print(f"BidSpotter: 0 results for '{keywords}'", file=sys.stderr)
    except Exception as e:
        print(f"BidSpotter search error: {e}", file=sys.stderr)
    return results


def search_ironplanet_api(keywords: str, state: str, max_results: int) -> list[dict]:
    """Try Iron Planet JSON search API (no browser needed)."""
    results = []
    try:
        r = requests.get(
            "https://www.ironplanet.com/rest/items",
            params={
                "q": keywords,
                "state": state,
                "pageSize": max_results,
                "status": "UPCOMING,ACTIVE",
            },
            headers={**HEADERS, "Accept": "application/json"},
            timeout=15,
        )
        ct = r.headers.get("Content-Type", "")
        if r.status_code == 200 and "json" in ct:
            data = r.json()
            items = data.get("items") or data.get("results") or data.get("data") or []
            for item in items[:max_results]:
                item_id = item.get("id") or item.get("itemId") or item.get("inventoryId", "")
                title = item.get("title") or item.get("name") or item.get("description", "")
                if item_id and title:
                    url = f"https://www.ironplanet.com/item/{item_id}"
                    results.append({"url": url, "title": title.strip(), "site": "ironplanet"})
            if results:
                return results
        print(f"Iron Planet API: status {r.status_code}, content-type '{ct}' — trying HTML", file=sys.stderr)
    except Exception as e:
        print(f"Iron Planet API error: {e} — trying HTML", file=sys.stderr)
    return results


def search_ironplanet_html(keywords: str, state: str, max_results: int) -> list[dict]:
    """Fallback: scrape Iron Planet search results page."""
    results = []
    try:
        r = requests.get(
            "https://www.ironplanet.com/results",
            params={"q": keywords, "state": state},
            headers=HEADERS,
            timeout=20,
        )
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")

        seen = set()
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if re.search(r"/item/\d+", href):
                if not href.startswith("http"):
                    href = "https://www.ironplanet.com" + href
                if href not in seen:
                    seen.add(href)
                    title = a.get_text(strip=True)
                    if len(title) > 5:
                        results.append({"url": href, "title": title, "site": "ironplanet"})
                        if len(results) >= max_results:
                            break
    except Exception as e:
        print(f"Iron Planet HTML error: {e}", file=sys.stderr)
    return results


def search_ironplanet(keywords: str, state: str, max_results: int) -> list[dict]:
    """Search Iron Planet: tries JSON API first, falls back to HTML."""
    results = search_ironplanet_api(keywords, state, max_results)
    if not results:
        results = search_ironplanet_html(keywords, state, max_results)
    if not results:
        print(f"Iron Planet: 0 results for '{keywords}' in {state}", file=sys.stderr)
    return results


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--state", required=True, help="Two-letter state code, e.g. AZ")
    p.add_argument("--category", default="", help="Item category")
    p.add_argument("--keywords", default="", help="Search keywords (overrides category if both given)")
    p.add_argument("--max", type=int, default=3, help="Max results per site")
    args = p.parse_args()

    term = args.keywords or args.category

    results = []
    results += search_publicsurplus(args.state, term, args.max)
    time.sleep(0.5)
    results += search_bidspotter(term, args.max)
    time.sleep(0.5)
    results += search_ironplanet(term, args.state, args.max)

    print(json.dumps(results))


if __name__ == "__main__":
    main()
