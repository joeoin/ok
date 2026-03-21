#!/usr/bin/env python3
"""Search GovDeals and PublicSurplus for auction listings.

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
    print(json.dumps({"error": "Missing deps: pip install requests beautifulsoup4"}))
    sys.exit(1)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


def search_govdeals(state: str, keywords: str, max_results: int) -> list[dict]:
    results = []
    try:
        params = {
            "fa": "Main.AdvSearchResultsNew",
            "kword": keywords,
            "state": state,
            "locType": "S",
            "sortBy": "ad",
            "recsPerPage": str(max_results * 3),
        }
        r = requests.get(
            "https://www.govdeals.com/index.cfm",
            params=params,
            headers=HEADERS,
            timeout=20,
        )
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")

        seen = set()
        for a in soup.find_all("a", href=True):
            href = a["href"]
            # GovDeals item pages contain fa=Main.Item or /item/ in the path
            if "fa=Main.Item" in href or re.search(r"/item/\d+", href):
                if not href.startswith("http"):
                    href = "https://www.govdeals.com" + href
                if href not in seen:
                    seen.add(href)
                    title = a.get_text(strip=True)
                    if title:
                        results.append({"url": href, "title": title, "site": "govdeals"})
                        if len(results) >= max_results:
                            break
    except Exception as e:
        print(f"GovDeals search error: {e}", file=sys.stderr)
    return results


def search_publicsurplus(state: str, keywords: str, max_results: int) -> list[dict]:
    results = []
    try:
        params = {
            "ac": "1",
            "fn": "search",
            "searchstate": state,
            "searchterm": keywords,
            "searchdist": "500",
        }
        r = requests.get(
            "https://www.publicsurplus.com/sms/browse/home",
            params=params,
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
    except Exception as e:
        print(f"PublicSurplus search error: {e}", file=sys.stderr)
    return results


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--state", required=True, help="Two-letter state code, e.g. AZ")
    p.add_argument("--category", default="", help="Item category")
    p.add_argument("--keywords", default="", help="Search keywords (overrides category if both given)")
    p.add_argument("--max", type=int, default=3, help="Max results per site")
    args = p.parse_args()

    # Build search term: prefer explicit keywords, fall back to category
    term = args.keywords or args.category

    results = []
    results += search_govdeals(args.state, term, args.max)
    time.sleep(0.5)
    results += search_publicsurplus(args.state, term, args.max)

    print(json.dumps(results))


if __name__ == "__main__":
    main()
