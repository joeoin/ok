#!/usr/bin/env python3
"""Debug PublicSurplus — browse AZ with no keyword to confirm link format."""

from playwright.sync_api import sync_playwright
import re

AUCTION_RE = re.compile(r"auctionId=|/auction/view")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    # Browse all AZ listings — no keyword, no zip filter
    page.goto("https://www.publicsurplus.com/sms/all,az/browse/search?page=1&sortBy=timeLeft",
              wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(2000)

    hrefs = page.eval_on_selector_all("a[href]", "els => els.map(e => e.getAttribute('href'))")
    auction_hrefs = [h for h in hrefs if AUCTION_RE.search(h or "")]

    print(f"AZ browse (no keyword): {len(auction_hrefs)} auction links")
    for h in auction_hrefs[:15]:
        print(f"  {h}")

    # Now try keyword search nationwide (no zip/radius)
    page.goto("https://www.publicsurplus.com/sms/browse/search?posting=y&page=1&sortBy=timeLeft&keyWord=generator&catId=&endHours=-1&startHours=-1&lowerPrice=&higherPrice=&milesLocation=&zipCode=&region=&search=Search",
              wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(2000)

    hrefs2 = page.eval_on_selector_all("a[href]", "els => els.map(e => e.getAttribute('href'))")
    auction_hrefs2 = [h for h in hrefs2 if AUCTION_RE.search(h or "")]

    print(f"\nNationwide 'generator' search: {len(auction_hrefs2)} auction links")
    for h in auction_hrefs2[:15]:
        print(f"  {h}")

    browser.close()
