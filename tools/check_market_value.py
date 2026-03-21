#!/usr/bin/env python3
"""Check market value by scraping eBay completed/sold listings.

Usage:
    python tools/check_market_value.py --item "Milwaukee M18 Drill Kit"

Output: JSON object with {median_price, price_range, sample_size, source} to stdout.
On failure or no data: JSON with median_price=0.
"""

import argparse
import json
import re
import statistics
import sys
import time
from urllib.parse import quote_plus

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


def get_ebay_sold_prices(item_name: str) -> list[float]:
    url = (
        f"https://www.ebay.com/sch/i.html"
        f"?_nkw={quote_plus(item_name)}"
        f"&LH_Complete=1&LH_Sold=1&_sop=13"
    )
    r = requests.get(url, headers=HEADERS, timeout=20)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")

    prices = []
    # eBay sold listings mark prices with .s-item__price
    for price_el in soup.select(".s-item__price"):
        text = price_el.get_text(strip=True)
        # Handle "X to Y" range — take midpoint
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

    for attempt in range(3):
        try:
            prices = get_ebay_sold_prices(args.item)

            if not prices:
                print(json.dumps({
                    "median_price": 0,
                    "price_range": "unknown",
                    "sample_size": 0,
                    "source": "ebay_completed",
                    "note": "No sold listings found",
                }))
                return

            median = round(statistics.median(prices), 2)
            print(json.dumps({
                "median_price": median,
                "price_range": f"${round(min(prices), 2)}–${round(max(prices), 2)}",
                "sample_size": len(prices),
                "source": "ebay_completed",
            }))
            return

        except requests.HTTPError as e:
            if e.response.status_code == 429:
                wait = 2 ** (attempt + 1)
                print(f"Rate limited, waiting {wait}s...", file=sys.stderr)
                time.sleep(wait)
            else:
                # Non-retryable HTTP error — return 0 rather than crashing the pipeline
                print(json.dumps({
                    "median_price": 0,
                    "price_range": "unknown",
                    "sample_size": 0,
                    "source": "ebay_completed",
                    "error": f"HTTP {e.response.status_code}",
                }))
                return
        except Exception as e:
            print(json.dumps({
                "median_price": 0,
                "price_range": "unknown",
                "sample_size": 0,
                "source": "ebay_completed",
                "error": str(e),
            }))
            return

    print(json.dumps({
        "median_price": 0,
        "price_range": "unknown",
        "sample_size": 0,
        "source": "ebay_completed",
        "error": "Max retries exceeded",
    }))


if __name__ == "__main__":
    main()
