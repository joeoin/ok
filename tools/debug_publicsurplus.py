#!/usr/bin/env python3
"""Debug PublicSurplus categories page."""

from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto("https://www.publicsurplus.com/sms/browse/allcat", wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(1500)

    # Get all links that look like category links
    links = page.eval_on_selector_all("a[href]", """els => els.map(e => ({
        href: e.getAttribute('href'),
        text: e.innerText.trim()
    }))""")

    print(f"Total links: {len(links)}\n")
    for l in links:
        if l['text'] and len(l['text']) > 2:
            print(f"  {l['text']:50s}  {l['href']}")

    browser.close()
