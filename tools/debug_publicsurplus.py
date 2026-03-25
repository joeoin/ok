#!/usr/bin/env python3
"""Intercept PublicSurplus network calls to find the real search API endpoint."""

from playwright.sync_api import sync_playwright
import json, re

KEYWORD = "generator"
ZIP = "85001"
RADIUS = 100

captured = []

def handle_response(response):
    url = response.url
    if "publicsurplus" in url and response.status == 200:
        ct = response.headers.get("content-type", "")
        if "json" in ct or "search" in url or "auction" in url or "browse" in url:
            try:
                body = response.body()
                captured.append({"url": url, "ct": ct, "body": body[:2000].decode("utf-8", errors="replace")})
            except Exception:
                pass

search_url = (
    "https://www.publicsurplus.com/sms/browse/search"
    f"?posting=y&page=1&sortBy=timeLeft&keyWord={KEYWORD}"
    f"&catId=&endHours=-1&startHours=-1&lowerPrice=&higherPrice="
    f"&milesLocation={RADIUS}&zipCode={ZIP}&region=&search=Search"
)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.on("response", handle_response)
    page.goto(search_url, wait_until="networkidle", timeout=30000)
    # also try scrolling to trigger lazy loads
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    page.wait_for_timeout(3000)
    browser.close()

print(f"\nCaptured {len(captured)} relevant responses:\n")
for r in captured:
    print(f"URL: {r['url']}")
    print(f"CT:  {r['ct']}")
    print(f"BODY (first 500): {r['body'][:500]}")
    print()
