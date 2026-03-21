#!/usr/bin/env python3
"""Check market value by scraping eBay completed/sold listings via Playwright.

Uses a real browser so JavaScript-rendered pages load correctly.

Usage:
    python tools/check_market_value.py --item "Milwaukee M18 Drill Kit"

Output: JSON object with {median_price, price_range, sample_size, source} to stdout.
On failure or no data: JSON with median_price=0.

Requirements:
    pip install playwright
    playwright install chromium --with-deps
"""

import argparse
import json
import re
import statistics
import sys
from urllib.parse import quote_plus


def get_ebay_sold_prices(item_name: str) -> list[float]:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print(json.dumps({
            "median_price": 0, "price_range": "unknown", "sample_size": 0,
            "source": "ebay_completed", "error": "playwright not installed — run: pip install playwright && playwright install chromium --with-deps",
        }))
        sys.exit(0)

    url = (
        f"https://www.ebay.com/sch/i.html"
        f"?_nkw={quote_plus(item_name)}"
        f"&LH_Complete=1&LH_Sold=1&_sop=13"
    )

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            )
        )
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_selector(".s-item__price", timeout=10000)
        content = page.content()
        browser.close()

    from bs4 import BeautifulSoup
    soup = BeautifulSoup(content, "html.parser")

    prices = []
    for price_el in soup.select(".s-item__price"):
        text = price_el.get_text(strip=True)
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
