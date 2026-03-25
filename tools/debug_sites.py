#!/usr/bin/env python3
"""Debug script — shows exactly what each auction site returns.

Run:
    python tools/debug_sites.py

Prints: HTTP status, final URL (after redirects), first 100 unique hrefs,
and first 2000 chars of HTML body for each site.
"""
import re
import sys
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


def dump(label, url, params=None):
    print(f"\n{'='*60}")
    print(f"SITE: {label}")
    print(f"URL:  {url}")
    if params:
        print(f"PARAMS: {params}")
    try:
        r = requests.get(url, params=params, headers=HEADERS, timeout=20)
        print(f"STATUS: {r.status_code}")
        print(f"FINAL URL: {r.url}")
        print(f"CONTENT-TYPE: {r.headers.get('Content-Type','?')}")

        soup = BeautifulSoup(r.text, "html.parser")

        # All unique hrefs
        hrefs = []
        seen = set()
        for a in soup.find_all("a", href=True):
            h = a["href"]
            if h not in seen:
                seen.add(h)
                hrefs.append(h)
        print(f"\nALL HREFS ({len(hrefs)} unique):")
        for h in hrefs[:100]:
            print(f"  {h}")

        # Raw HTML snippet
        print(f"\nHTML BODY (first 3000 chars):")
        print(r.text[:3000])

    except Exception as e:
        print(f"ERROR: {e}")


# ── PublicSurplus ──────────────────────────────────────────────────────────────
dump(
    "PublicSurplus",
    "https://www.publicsurplus.com/sms/browse/search",
    params={
        "posting": "y",
        "page": "1",
        "sortBy": "timeLeft",
        "keyWord": "generator",
        "catId": "",
        "endHours": "-1",
        "startHours": "-1",
        "lowerPrice": "",
        "higherPrice": "",
        "milesLocation": "100",
        "zipCode": "85001",
        "region": "",
        "search": "Search",
    },
)

# ── BidSpotter search page ─────────────────────────────────────────────────────
dump(
    "BidSpotter (search)",
    "https://www.bidspotter.com/en-us/auction-catalogues",
    params={"q": "generator", "pageNo": 1},
)

# ── Iron Planet ────────────────────────────────────────────────────────────────
dump(
    "Iron Planet",
    "https://www.ironplanet.com/jsp/s/search.ips",
    params={"kw": "generator"},
)
