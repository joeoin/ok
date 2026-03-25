#!/usr/bin/env python3
"""Debug script — targeted href inspection per site.

Run:
    python tools/debug_sites.py
"""
import re
import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


def fetch(url, params=None):
    return requests.get(url, params=params, headers=HEADERS, timeout=20)


def show_hrefs(label, url, params=None, href_filter=None, show_n=60):
    print(f"\n{'='*60}")
    print(f"SITE: {label}")
    print(f"URL:  {url}")
    if params:
        print(f"PARAMS: {params}")
    r = fetch(url, params)
    print(f"STATUS: {r.status_code}  FINAL: {r.url}")
    soup = BeautifulSoup(r.text, "html.parser")
    all_hrefs = list(dict.fromkeys(a["href"] for a in soup.find_all("a", href=True)))
    if href_filter:
        matched = [h for h in all_hrefs if href_filter(h)]
        print(f"TOTAL {len(all_hrefs)} hrefs | FILTERED {len(matched)}")
        for h in matched[:show_n]:
            print(f"  {h}")
    else:
        print(f"TOTAL {len(all_hrefs)} hrefs (first {show_n} unfiltered):")
        for h in all_hrefs[:show_n]:
            print(f"  {h}")


# ── 1. PublicSurplus: show ALL hrefs unfiltered to find real auction URL format ─
show_hrefs(
    "PublicSurplus browse AZ — ALL hrefs unfiltered",
    "https://www.publicsurplus.com/sms/all,az/browse/search",
    show_n=60,
)

# ── 2. BidSpotter: fetch a real catalog detail page ─────────────────────────────
# From previous debug: catalogue-id-witham10188 is a real catalog
show_hrefs(
    "BidSpotter catalog detail — witham10188",
    "https://www.bidspotter.com/en-us/auction-catalogues/witham/catalogue-id-witham10188",
    href_filter=lambda h: re.search(r"/en-us/auction-catalogues/.+/.+/.+", h) is not None,
    show_n=40,
)

# Also check whether BidSpotter exposes an items/lots JSON endpoint
print("\n" + "="*60)
print("BidSpotter catalog lots — try /lots/ endpoint")
url = "https://www.bidspotter.com/en-us/auction-catalogues/witham/catalogue-id-witham10188/lots"
r = fetch(url)
print(f"STATUS: {r.status_code}  FINAL: {r.url}")
soup = BeautifulSoup(r.text, "html.parser")
hrefs = list(dict.fromkeys(a["href"] for a in soup.find_all("a", href=True)))
lot_hrefs = [h for h in hrefs if re.search(r"/en-us/auction-catalogues/.+/.+/.+", h)]
print(f"Lot-like hrefs ({len(lot_hrefs)}):")
for h in lot_hrefs[:40]:
    print(f"  {h}")

# ── 3. PublicSurplus: try their JSON/AJAX endpoint directly ────────────────────
print("\n" + "="*60)
print("PublicSurplus AJAX JSON endpoint probe")
for url, params in [
    ("https://www.publicsurplus.com/sms/browse/search.json", {"keyWord": "generator", "page": "1", "region": "az"}),
    ("https://www.publicsurplus.com/sms/all,az/browse/search", {"keyWord": "generator", "page": "1", "format": "json"}),
    ("https://www.publicsurplus.com/sms/all,az/browse/auctions", {"keyWord": "generator", "page": "1"}),
]:
    try:
        r = fetch(url, params)
        ct = r.headers.get("content-type", "")
        print(f"  {r.status_code} {ct[:40]:40s}  {r.url[:80]}")
        if "json" in ct:
            print(f"  JSON BODY: {r.text[:500]}")
    except Exception as e:
        print(f"  ERROR: {e}")
