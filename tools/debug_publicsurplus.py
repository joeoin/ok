#!/usr/bin/env python3
"""Debug PublicSurplus Playwright scrape — shows page title, all hrefs, and raw HTML snippet."""

from playwright.sync_api import sync_playwright
import re

KEYWORD = "generator"

urls_to_try = [
    # 1. Zip+radius search
    (
        "zip+radius search",
        "https://www.publicsurplus.com/sms/browse/search"
        f"?posting=y&page=1&sortBy=timeLeft&keyWord={KEYWORD}"
        "&catId=&endHours=-1&startHours=-1&lowerPrice=&higherPrice="
        "&milesLocation=100&zipCode=85001&region=&search=Search"
    ),
    # 2. Arizona state search with keyword
    (
        "AZ state keyword search",
        f"https://www.publicsurplus.com/sms/all,az/browse/search?keyWord={KEYWORD}&page=1&sortBy=timeLeft"
    ),
    # 3. Arizona state browse — no keyword, just list everything
    (
        "AZ state browse (no keyword)",
        "https://www.publicsurplus.com/sms/all,az/browse/search?page=1&sortBy=timeLeft"
    ),
]

AUCTION_RE = re.compile(r"auctionId=|/auction/view")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    for label, url in urls_to_try:
        print(f"\n{'='*60}")
        print(f"TEST: {label}")
        print(f"URL:  {url}")
        page = browser.new_page()
        page.goto(url, wait_until="networkidle", timeout=30000)
        print(f"Title: {page.title()}")

        hrefs = page.eval_on_selector_all("a[href]", "els => els.map(e => e.getAttribute('href'))")
        auction_hrefs = [h for h in hrefs if AUCTION_RE.search(h or "")]
        all_unique = list(dict.fromkeys(hrefs))
        print(f"Total hrefs: {len(all_unique)} | Auction hrefs: {len(auction_hrefs)}")
        for h in auction_hrefs[:10]:
            print(f"  AUCTION: {h}")
        if not auction_hrefs:
            # show first 10 hrefs to help diagnose
            print("  (no auction hrefs — first 10 hrefs:)")
            for h in all_unique[:10]:
                print(f"    {h}")
        page.close()

    browser.close()
