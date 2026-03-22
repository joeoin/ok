#!/usr/bin/env python3
"""Fetch and parse a single auction listing page.

Usage:
    python tools/fetch_listing.py --url "https://www.govdeals.com/..."

Output: JSON object with listing fields to stdout.
On failure: JSON with {"error": "..."} and exit code 1.
Retries up to 3x with backoff on rate-limit (429) responses.
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


def extract_price(text: str) -> float:
    m = re.search(r"\$?([\d,]+\.?\d*)", text.replace(",", ""))
    return float(m.group(1)) if m else 0.0


def parse_govdeals(soup: BeautifulSoup, url: str) -> dict:
    result: dict = {"url": url, "site": "govdeals"}

    # Title
    h1 = soup.find("h1") or soup.find("h2")
    result["title"] = h1.get_text(strip=True) if h1 else ""

    # Lot number from URL: /en/asset/{assetId}/{sellerId} or legacy ?invId=X
    lot_m = re.search(r"/en/asset/(\d+/\d+)", url) or re.search(r"[?&]invId=(\w+)", url)
    result["lot"] = lot_m.group(1) if lot_m else ""

    # Current bid — scan labels for "Current Bid" / "High Bid"
    result["current_bid"] = 0.0
    for label in soup.find_all(string=re.compile(r"Current Bid|High Bid", re.I)):
        parent = label.find_parent()
        if parent:
            price_text = parent.get_text(" ", strip=True)
            val = extract_price(price_text)
            if val:
                result["current_bid"] = val
                break

    # End date
    result["end_date"] = ""
    for label in soup.find_all(string=re.compile(r"Close Date|End Date|Auction Ends", re.I)):
        parent = label.find_parent()
        if parent:
            date_text = parent.get_text(" ", strip=True)
            date_m = re.search(r"\d{1,2}/\d{1,2}/\d{2,4}", date_text)
            if date_m:
                result["end_date"] = date_m.group(0)
                break

    # Location
    result["location"] = ""
    for label in soup.find_all(string=re.compile(r"^Location$|^Pickup Location$", re.I)):
        parent = label.find_parent()
        if parent:
            sib = parent.find_next_sibling()
            if sib:
                result["location"] = sib.get_text(strip=True)[:100]
                break

    # Photos — img tags with govdeals photo CDN patterns
    photos = []
    for img in soup.find_all("img", src=True):
        src = img["src"]
        if any(x in src.lower() for x in ["photo", "image", "img", "/items/"]):
            if not src.startswith("http"):
                src = "https://www.govdeals.com" + src
            photos.append(src)
    result["photos"] = list(dict.fromkeys(photos))[:10]

    # Description
    desc_el = (
        soup.find("div", id=re.compile(r"desc", re.I))
        or soup.find("div", class_=re.compile(r"desc|detail|item.?info", re.I))
    )
    result["description"] = desc_el.get_text(" ", strip=True)[:2000] if desc_el else ""

    return result


def parse_publicsurplus(soup: BeautifulSoup, url: str) -> dict:
    result: dict = {"url": url, "site": "publicsurplus"}

    h1 = soup.find("h1")
    result["title"] = h1.get_text(strip=True) if h1 else ""

    lot_m = re.search(r"[?&]id=(\d+)", url)
    result["lot"] = lot_m.group(1) if lot_m else ""

    result["current_bid"] = 0.0
    for label in soup.find_all(string=re.compile(r"Current Bid|Minimum Bid", re.I)):
        parent = label.find_parent()
        if parent:
            val = extract_price(parent.get_text())
            if val:
                result["current_bid"] = val
                break

    result["end_date"] = ""
    for label in soup.find_all(string=re.compile(r"Auction Ends|Close Date", re.I)):
        parent = label.find_parent()
        if parent:
            date_m = re.search(r"\d{1,2}/\d{1,2}/\d{2,4}", parent.get_text(" "))
            if date_m:
                result["end_date"] = date_m.group(0)
                break

    result["location"] = ""
    for label in soup.find_all(string=re.compile(r"Location|Agency", re.I)):
        parent = label.find_parent()
        if parent:
            result["location"] = parent.get_text(strip=True)[:100]
            break

    result["photos"] = [
        img["src"] for img in soup.find_all("img", src=True)
        if "photo" in img.get("src", "").lower()
    ][:10]

    result["description"] = ""
    return result


def fetch_with_playwright(url: str) -> str:
    """Fetch a JS-rendered page using Playwright and return the HTML."""
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
            ],
        )
        page = browser.new_page(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            )
        )
        page.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
        page.goto(url, timeout=30000, wait_until="domcontentloaded")
        # Wait for the bid price to appear instead of sleeping blindly
        try:
            page.wait_for_selector("text=/Current Bid|High Bid|Starting Bid/i", timeout=10000)
        except PlaywrightTimeout:
            pass  # Page may have loaded differently — use whatever content we have
        html = page.content()
        browser.close()
    return html


def fetch(url: str) -> dict:
    if "govdeals.com" in url:
        # GovDeals is a JS-rendered Angular app — needs Playwright
        html = fetch_with_playwright(url)
        soup = BeautifulSoup(html, "html.parser")
        return parse_govdeals(soup, url)

    r = requests.get(url, headers=HEADERS, timeout=20)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    if "publicsurplus.com" in url:
        return parse_publicsurplus(soup, url)
    return parse_govdeals(soup, url)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--url", required=True, help="Auction listing URL")
    args = p.parse_args()

    for attempt in range(3):
        try:
            data = fetch(args.url)
            print(json.dumps(data))
            return
        except requests.HTTPError as e:
            if e.response.status_code == 429:
                wait = 2 ** (attempt + 1)
                print(f"Rate limited, waiting {wait}s...", file=sys.stderr)
                time.sleep(wait)
            else:
                print(json.dumps({"error": f"HTTP {e.response.status_code}", "url": args.url}))
                sys.exit(1)
        except Exception as e:
            print(json.dumps({"error": str(e), "url": args.url}))
            sys.exit(1)

    print(json.dumps({"error": "Max retries exceeded after rate limiting", "url": args.url}))
    sys.exit(1)


if __name__ == "__main__":
    main()
