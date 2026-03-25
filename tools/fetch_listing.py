#!/usr/bin/env python3
"""Fetch and parse a single auction listing page.

Usage:
    python tools/fetch_listing.py --url "https://www.publicsurplus.com/..."
    python tools/fetch_listing.py --url "https://www.bidspotter.com/..."
    python tools/fetch_listing.py --url "https://www.ironplanet.com/..."

Output: JSON object with listing fields to stdout.
On failure: JSON with {"error": "..."} and exit code 1.

Requirements:
    pip install requests beautifulsoup4
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


# ── Public Surplus ────────────────────────────────────────────────────────────

def parse_publicsurplus(soup: BeautifulSoup, url: str) -> dict:
    result: dict = {"url": url, "site": "publicsurplus"}

    h1 = soup.find("h1")
    result["title"] = h1.get_text(strip=True) if h1 else ""

    lot_m = re.search(r"[?&]id=(\d+)", url)
    result["lot"] = lot_m.group(1) if lot_m else ""

    result["current_bid"] = 0.0
    for label in soup.find_all(string=re.compile(r"Current Bid|Minimum Bid|High Bid", re.I)):
        parent = label.find_parent()
        if parent:
            val = extract_price(parent.get_text())
            if val:
                result["current_bid"] = val
                break

    result["end_date"] = ""
    for label in soup.find_all(string=re.compile(r"Auction Ends|Close Date|Closing", re.I)):
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


# ── BidSpotter ────────────────────────────────────────────────────────────────

def parse_bidspotter(soup: BeautifulSoup, url: str) -> dict:
    result: dict = {"url": url, "site": "bidspotter"}

    h1 = soup.find("h1") or soup.find("h2")
    result["title"] = h1.get_text(strip=True) if h1 else ""

    lot_m = re.search(r"/lots/(\w+)", url)
    result["lot"] = lot_m.group(1) if lot_m else ""

    result["current_bid"] = 0.0
    for label in soup.find_all(string=re.compile(r"Current Bid|Starting Bid|Reserve|Bid Now", re.I)):
        parent = label.find_parent()
        if parent:
            val = extract_price(parent.get_text(" ", strip=True))
            if val:
                result["current_bid"] = val
                break

    result["end_date"] = ""
    for label in soup.find_all(string=re.compile(r"Auction Ends|Closing|End Time|Close Date", re.I)):
        parent = label.find_parent()
        if parent:
            date_m = re.search(r"\d{1,2}/\d{1,2}/\d{2,4}", parent.get_text(" "))
            if date_m:
                result["end_date"] = date_m.group(0)
                break

    result["location"] = ""
    for label in soup.find_all(string=re.compile(r"^Location$|Auction Location|Pickup", re.I)):
        parent = label.find_parent()
        if parent:
            sib = parent.find_next_sibling()
            loc_text = (sib.get_text(strip=True) if sib else parent.get_text(strip=True))
            if loc_text:
                result["location"] = loc_text[:100]
                break

    photos = []
    for img in soup.find_all("img", src=True):
        src = img["src"]
        if any(x in src.lower() for x in ["photo", "image", "lot", "item", "/img/"]):
            if not src.startswith("http"):
                src = "https://www.bidspotter.com" + src
            photos.append(src)
    result["photos"] = list(dict.fromkeys(photos))[:10]

    desc_el = (
        soup.find("div", class_=re.compile(r"desc|detail|lot.?info|item.?info", re.I))
        or soup.find("section", class_=re.compile(r"desc|detail", re.I))
    )
    result["description"] = desc_el.get_text(" ", strip=True)[:2000] if desc_el else ""

    return result


# ── Iron Planet ───────────────────────────────────────────────────────────────

def fetch_ironplanet_api(url: str) -> dict | None:
    """Try Iron Planet item JSON API endpoint (no browser needed)."""
    m = re.search(r"/item/(\d+)", url)
    if not m:
        return None
    item_id = m.group(1)
    try:
        r = requests.get(
            f"https://www.ironplanet.com/rest/items/{item_id}",
            headers={**HEADERS, "Accept": "application/json"},
            timeout=15,
        )
        ct = r.headers.get("Content-Type", "")
        if r.status_code == 200 and "json" in ct:
            item = r.json()
            title = item.get("title") or item.get("name") or item.get("description", "")
            if title:
                return {
                    "url": url,
                    "site": "ironplanet",
                    "title": title,
                    "lot": str(item_id),
                    "current_bid": float(item.get("currentBid") or item.get("price") or item.get("currentPrice") or 0),
                    "end_date": (item.get("closeDate") or item.get("endDate") or item.get("saleDate") or "")[:10],
                    "location": item.get("location") or item.get("city") or item.get("region") or "",
                    "photos": item.get("photos") or item.get("images") or [],
                    "description": item.get("description") or item.get("longDescription") or "",
                }
    except Exception as e:
        print(f"Iron Planet item API failed for {url}: {e}", file=sys.stderr)
    return None


def parse_ironplanet(soup: BeautifulSoup, url: str) -> dict:
    result: dict = {"url": url, "site": "ironplanet"}

    h1 = soup.find("h1") or soup.find("h2")
    result["title"] = h1.get_text(strip=True) if h1 else ""

    item_m = re.search(r"/item/(\d+)", url)
    result["lot"] = item_m.group(1) if item_m else ""

    result["current_bid"] = 0.0
    for label in soup.find_all(string=re.compile(r"Current Bid|Winning Bid|Reserve Price|Buy Now|Starting Bid", re.I)):
        parent = label.find_parent()
        if parent:
            val = extract_price(parent.get_text(" ", strip=True))
            if val:
                result["current_bid"] = val
                break

    result["end_date"] = ""
    for label in soup.find_all(string=re.compile(r"Auction Closes|Closing Date|Sale Date|End Date", re.I)):
        parent = label.find_parent()
        if parent:
            date_m = re.search(r"\d{1,2}/\d{1,2}/\d{2,4}", parent.get_text(" "))
            if date_m:
                result["end_date"] = date_m.group(0)
                break

    result["location"] = ""
    for label in soup.find_all(string=re.compile(r"^Location$|Country|Region|Yard", re.I)):
        parent = label.find_parent()
        if parent:
            sib = parent.find_next_sibling()
            loc_text = (sib.get_text(strip=True) if sib else "")
            if loc_text:
                result["location"] = loc_text[:100]
                break

    photos = []
    for img in soup.find_all("img", src=True):
        src = img["src"]
        if any(x in src.lower() for x in ["photo", "image", "item", "equipment", "/photos/"]):
            if not src.startswith("http"):
                src = "https://www.ironplanet.com" + src
            photos.append(src)
    result["photos"] = list(dict.fromkeys(photos))[:10]

    desc_el = (
        soup.find("div", class_=re.compile(r"desc|detail|condition|spec|info", re.I))
    )
    result["description"] = desc_el.get_text(" ", strip=True)[:2000] if desc_el else ""

    return result


# ── Main fetch dispatcher ─────────────────────────────────────────────────────

def fetch(url: str) -> dict:
    if "ironplanet.com" in url:
        # Try JSON API first (no browser needed)
        api_result = fetch_ironplanet_api(url)
        if api_result and api_result.get("title"):
            return api_result
        # Fall back to HTML
        r = requests.get(url, headers=HEADERS, timeout=20)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        return parse_ironplanet(soup, url)

    r = requests.get(url, headers=HEADERS, timeout=20)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")

    if "publicsurplus.com" in url:
        return parse_publicsurplus(soup, url)
    if "bidspotter.com" in url:
        return parse_bidspotter(soup, url)

    return {"url": url, "site": "unknown", "error": "Unsupported site"}


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
