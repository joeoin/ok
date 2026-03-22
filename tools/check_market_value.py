#!/usr/bin/env python3
"""Check market value by scraping eBay completed/sold listings.

Uses plain HTTP requests — no Playwright or browser required.

Usage:
    python tools/check_market_value.py --item "Milwaukee M18 Drill Kit"

Output: JSON object with {median_price, price_range, sample_size, source} to stdout.
On failure or no data: JSON with median_price=0.

Requirements:
    pip install requests beautifulsoup4
"""

import argparse
import json
import re
import statistics
import sys
from urllib.parse import quote_plus

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print(json.dumps({
        "median_price": 0, "price_range": "unknown", "sample_size": 0,
        "source": "ebay_completed", "error": "Missing deps: pip install requests beautifulsoup4",
    }))
    sys.exit(0)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/avif,image/webp,image/apng,*/*;q=0.8"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
}


def get_ebay_sold_prices(item_name: str) -> list[float]:
    url = (
        f"https://www.ebay.com/sch/i.html"
        f"?_nkw={quote_plus(item_name)}"
        f"&LH_Complete=1&LH_Sold=1&_sop=13"
    )

    session = requests.Session()
    session.headers.update(HEADERS)

    try:
        r = session.get(url, timeout=20)
        r.raise_for_status()
    except requests.RequestException as e:
        raise RuntimeError(f"eBay request failed: {e}") from e

    soup = BeautifulSoup(r.text, "html.parser")

    prices = []
    for el in soup.select(".s-item__price"):
        text = el.get_text(strip=True)
        # Handle price ranges like "$50.00 to $80.00"
        if " to " in text.lower():
            nums = re.findall(r"[\d,]+\.?\d*", text)
            if len(nums) >= 2:
                lo = float(nums[0].replace(",", ""))
                hi = float(nums[1].replace(",", ""))
                prices.append((lo + hi) / 2)
        else:
            m = re.search(r"[\d,]+\.?\d*", text.replace(",", ""))
            if m:
                val = float(m.group())
                if 1 < val < 100_000:
                    prices.append(val)

    return prices[:20]


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--item", required=True, help="Item name to look up on eBay sold listings")
    args = p.parse_args()

    try:
        prices = get_ebay_sold_prices(args.item)

        if not prices:
            print(json.dumps({
                "median_price": 0, "price_range": "unknown", "sample_size": 0,
                "source": "ebay_completed", "note": "No sold listings found",
            }))
            return

        median = round(statistics.median(prices), 2)
        print(json.dumps({
            "median_price": median,
            "price_range": f"${round(min(prices), 2)}–${round(max(prices), 2)}",
            "sample_size": len(prices),
            "source": "ebay_completed",
        }))

    except Exception as e:
        print(json.dumps({
            "median_price": 0, "price_range": "unknown", "sample_size": 0,
            "source": "ebay_completed", "error": str(e),
        }))


if __name__ == "__main__":
    main()
