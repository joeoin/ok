#!/usr/bin/env python3
"""Debug PublicSurplus Playwright scrape — shows page title, all hrefs, and raw HTML snippet."""

from playwright.sync_api import sync_playwright
import re

ZIP = "85001"
RADIUS = 100
KEYWORD = "generator"

url = (
    "https://www.publicsurplus.com/sms/browse/search"
    f"?posting=y&page=1&sortBy=timeLeft&keyWord={KEYWORD}"
    f"&catId=&endHours=-1&startHours=-1&lowerPrice=&higherPrice="
    f"&milesLocation={RADIUS}&zipCode={ZIP}&region=&search=Search"
)

print(f"URL: {url}\n")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto(url, wait_until="networkidle", timeout=30000)

    print(f"Page title: {page.title()}")
    print(f"Final URL:  {page.url}\n")

    # Print all unique hrefs
    hrefs = page.eval_on_selector_all("a[href]", "els => els.map(e => e.getAttribute('href'))")
    unique = list(dict.fromkeys(hrefs))
    print(f"Total unique hrefs: {len(unique)}")
    print("\n--- All hrefs ---")
    for h in unique:
        print(f"  {h}")

    # Print a snippet of the HTML around any "auction" text
    html = page.content()
    idx = html.lower().find("auction")
    if idx >= 0:
        print(f"\n--- HTML snippet around 'auction' (char {idx}) ---")
        print(html[max(0, idx-200):idx+500])

    browser.close()
