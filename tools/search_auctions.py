#!/usr/bin/env python3
"""Search PublicSurplus, BidSpotter, and Iron Planet for auction listings.

Usage:
    python tools/search_auctions.py --state AZ --zip 85001 --radius 100 --category "Tools & Equipment" --max 3
    python tools/search_auctions.py --state AZ --zip 85001 --radius 100 --keywords "generator" --max 3

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


def search_publicsurplus(keywords: str, state: str, max_results: int) -> list[dict]:
    """Search PublicSurplus using state browse URL: /sms/all,{state}/browse/search"""
    results = []
    try:
        r = requests.get(
            f"https://www.publicsurplus.com/sms/all,{state.lower()}/browse/search",
            params={
                "keyWord": keywords,
                "sortBy": "timeLeft",
                "page": "1",
            },
            headers=HEADERS,
            timeout=20,
        )
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")

        # Parse results table: div.baseDiv -> second table -> tr rows -> first td link
        base = soup.find("div", class_="baseDiv")
        tables = (base or soup).find_all("table")
        rows = tables[1].find_all("tr") if len(tables) > 1 else []
        if rows:
            rows = rows[1:]  # skip header row

        seen = set()
        for row in rows:
            tds = row.find_all("td")
            if not tds:
                continue
            a = tds[0].find("a", href=True)
            if not a:
                continue
            href = a["href"]
            if not href.startswith("http"):
                href = "https://www.publicsurplus.com" + href
            if href not in seen and "/auction/view" in href:
                seen.add(href)
                title = a.get_text(strip=True)
                if len(title) > 5:
                    results.append({"url": href, "title": title, "site": "publicsurplus"})
                    if len(results) >= max_results:
                        break

        # Fallback: scan all links if table parse found nothing
        if not results:
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
    """Search BidSpotter: step 1 finds catalogs, step 2 extracts lots from each catalog."""
    results = []
    try:
        # Step 1: search returns catalog-level pages, not individual lots
        r = requests.get(
            "https://www.bidspotter.com/en-us/auction-catalogues",
            params={"q": keywords, "pageNo": 1},
            headers=HEADERS,
            timeout=20,
        )
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")

        # Collect catalog page links (e.g. /en-us/auction-catalogues/auctioneer/catalog-id)
        catalog_links = []
        seen_catalogs = set()
        for a in soup.find_all("a", href=True):
            href = a["href"]
            # Catalog links: /en-us/auction-catalogues/{slug}/{id} but NOT /lots/
            if (
                re.search(r"/en-us/auction-catalogues/[^/]+/[^/]+$", href)
                and "/lots" not in href
                and href not in seen_catalogs
            ):
                if not href.startswith("http"):
                    href = "https://www.bidspotter.com" + href
                seen_catalogs.add(href)
                catalog_links.append(href)
                if len(catalog_links) >= 3:
                    break

        if not catalog_links:
            print(f"BidSpotter: no catalogs found for '{keywords}'", file=sys.stderr)
            return results

        # Step 2: visit each catalog page and extract individual lot links
        seen_lots = set()
        for cat_url in catalog_links:
            if len(results) >= max_results:
                break
            try:
                time.sleep(0.5)
                cr = requests.get(cat_url, headers=HEADERS, timeout=20)
                cr.raise_for_status()
                csoup = BeautifulSoup(cr.text, "html.parser")
                for a in csoup.find_all("a", href=True):
                    href = a["href"]
                    if "/lots/" in href:
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
            print(f"BidSpotter: 0 lots found for '{keywords}'", file=sys.stderr)
    except Exception as e:
        print(f"BidSpotter search error: {e}", file=sys.stderr)
    return results


def search_ironplanet(keywords: str, max_results: int) -> list[dict]:
    """Search Iron Planet via their JSP search endpoint."""
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

        seen = set()
        for a in soup.find_all("a", href=True):
            href = a["href"]
            # Item URLs: /item/{id} or /jsp/s/item.ips or similar
            if re.search(r"/(item|itemId)[=/]\d+", href) or re.search(r"/item/\d+", href):
                if not href.startswith("http"):
                    href = "https://www.ironplanet.com" + href
                if href not in seen:
                    seen.add(href)
                    title = a.get_text(strip=True)
                    if len(title) > 5:
                        results.append({"url": href, "title": title, "site": "ironplanet"})
                        if len(results) >= max_results:
                            break

        if not results:
            print(f"Iron Planet: 0 results for '{keywords}'", file=sys.stderr)
    except Exception as e:
        print(f"Iron Planet search error: {e}", file=sys.stderr)
    return results


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--state", required=True, help="Two-letter state code, e.g. AZ")
    p.add_argument("--zip", default="", help="ZIP code for PublicSurplus location filter")
    p.add_argument("--radius", type=int, default=100, help="Search radius in miles (for PublicSurplus)")
    p.add_argument("--category", default="", help="Item category")
    p.add_argument("--keywords", default="", help="Search keywords (overrides category if both given)")
    p.add_argument("--max", type=int, default=3, help="Max results per site")
    args = p.parse_args()

    term = args.keywords or args.category
    zip_code = args.zip or "00000"

    results = []
    results += search_publicsurplus(term, args.state, args.max)
    time.sleep(0.5)
    results += search_bidspotter(term, args.max)
    time.sleep(0.5)
    results += search_ironplanet(term, args.max)

    print(json.dumps(results))


if __name__ == "__main__":
    main()
