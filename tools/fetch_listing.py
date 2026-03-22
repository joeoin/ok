#!/usr/bin/env python3
"""Fetch and parse a single auction listing page.

Usage:
    python tools/fetch_listing.py --url "https://www.govdeals.com/..."
    python tools/fetch_listing.py --url "https://www.publicsurplus.com/..."

Output: JSON object with listing fields to stdout.
On failure: JSON with {"error": "..."} and exit code 1.

Requirements:
    pip install requests beautifulsoup4
    pip install playwright && playwright install chromium   (only needed for GovDeals)
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
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def extract_price(text: str) -> float:
    m = re.search(r"\$?([\d,]+\.?\d*)", text.replace(",", ""))
    return float(m.group(1)) if m else 0.0


def parse_govdeals(soup: BeautifulSoup, url: str) -> dict:
    result: dict = {"url": url, "site": "govdeals"}

    h1 = soup.find("h1") or soup.find("h2")
    result["title"] = h1.get_text(strip=True) if h1 else ""

    lot_m = re.search(r"/en/asset/(\d+/\d+)", url) or re.search(r"[?&]invId=(\w+)", url)
    result["lot"] = lot_m.group(1) if lot_m else ""

    result["current_bid"] = 0.0
    for label in soup.find_all(string=re.compile(r"Current Bid|High Bid|Starting Bid", re.I)):
        parent = label.find_parent()
        if parent:
            val = extract_price(parent.get_text(" ", strip=True))
            if val:
                result["current_bid"] = val
                break

    result["end_date"] = ""
    for label in soup.find_all(string=re.compile(r"Close Date|End Date|Auction Ends", re.I)):
        parent = label.find_parent()
        if parent:
            date_text = parent.get_text(" ", strip=True)
            date_m = re.search(r"\d{1,2}/\d{1,2}/\d{2,4}", date_text)
            if date_m:
                result["end_date"] = date_m.group(0)
                break

    result["location"] = ""
    for label in soup.find_all(string=re.compile(r"^Location$|^Pickup Location$", re.I)):
        parent = label.find_parent()
        if parent:
            sib = parent.find_next_sibling()
            if sib:
                result["location"] = sib.get_text(strip=True)[:100]
                break

    photos = []
    for img in soup.find_all("img", src=True):
        src = img["src"]
        if any(x in src.lower() for x in ["photo", "image", "img", "/items/"]):
            if not src.startswith("http"):
                src = "https://www.govdeals.com" + src
            photos.append(src)
    result["photos"] = list(dict.fromkeys(photos))[:10]

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


def fetch_govdeals_api(url: str) -> dict | None:
    """Try GovDeals item API endpoint directly (no browser needed)."""
    # Extract asset ID and seller ID from URL like /en/asset/12345/678
    m = re.search(r"/en/asset/(\d+)/(\d+)", url)
    if not m:
        return None
    asset_id, seller_id = m.group(1), m.group(2)
    try:
        r = requests.get(
            f"https://www.govdeals.com/api/v2/assets/{asset_id}",
            params={"sellerId": seller_id},
            headers={**HEADERS, "Accept": "application/json", "Referer": "https://www.govdeals.com/"},
            timeout=15,
        )
        if r.status_code == 200 and "json" in r.headers.get("Content-Type", ""):
            item = r.json()
            return {
                "url": url,
                "site": "govdeals",
                "title": item.get("title") or item.get("name", ""),
                "lot": f"{asset_id}/{seller_id}",
                "current_bid": float(item.get("currentBid") or item.get("currentPrice") or 0),
                "end_date": (item.get("closeDate") or item.get("endDate") or "")[:10],
                "location": item.get("location") or item.get("city") or "",
                "photos": item.get("photos") or item.get("images") or [],
                "description": item.get("description") or "",
            }
    except Exception as e:
        print(f"GovDeals item API failed for {url}: {e}", file=sys.stderr)
    return None


def fetch_govdeals_playwright(url: str) -> str:
    """Fetch GovDeals listing page via browser (fallback when API fails)."""
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
            user_agent=HEADERS["User-Agent"],
        )
        page.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
        )
        page.goto(url, timeout=30000, wait_until="domcontentloaded")
        try:
            page.wait_for_selector(
                "text=/Current Bid|High Bid|Starting Bid/i", timeout=12000
            )
        except PlaywrightTimeout:
            pass
        html = page.content()
        browser.close()
    return html


def fetch(url: str) -> dict:
    if "govdeals.com" in url:
        # Try API first (no browser needed)
        api_result = fetch_govdeals_api(url)
        if api_result and api_result.get("title"):
            return api_result
        # Fall back to Playwright
        try:
            html = fetch_govdeals_playwright(url)
            soup = BeautifulSoup(html, "html.parser")
            return parse_govdeals(soup, url)
        except ImportError:
            raise RuntimeError(
                "GovDeals requires a browser. Run: pip install playwright && playwright install chromium"
            )

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

    print(json.dumps({"error": "Max retries exceeded", "url": args.url}))
    sys.exit(1)


if __name__ == "__main__":
    main()
