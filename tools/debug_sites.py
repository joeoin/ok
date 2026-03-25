#!/usr/bin/env python3
"""Debug script — shows filtered hrefs and HTML for each auction site.

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


def dump(label, url, params=None, href_filter=None):
    print(f"\n{'='*60}")
    print(f"SITE: {label}")
    print(f"URL:  {url}")
    if params:
        print(f"PARAMS: {params}")
    try:
        r = requests.get(url, params=params, headers=HEADERS, timeout=20)
        print(f"STATUS: {r.status_code}")
        print(f"FINAL URL: {r.url}")

        soup = BeautifulSoup(r.text, "html.parser")
        all_hrefs = list(dict.fromkeys(
            a["href"] for a in soup.find_all("a", href=True)
        ))
        print(f"TOTAL HREFS: {len(all_hrefs)}")

        if href_filter:
            matched = [h for h in all_hrefs if href_filter(h)]
            print(f"FILTERED HREFS ({len(matched)} matched):")
            for h in matched[:50]:
                print(f"  {h}")
        else:
            print(f"ALL HREFS (first 50):")
            for h in all_hrefs[:50]:
                print(f"  {h}")

        print(f"\nHTML BODY (first 2000 chars):")
        print(r.text[:2000])

    except Exception as e:
        print(f"ERROR: {e}")


# ── PublicSurplus — use state browse URL ──────────────────────────────────────
# Correct URL format discovered from their own nav: /sms/all,az/browse/search
dump(
    "PublicSurplus (state browse, no keyword filter)",
    "https://www.publicsurplus.com/sms/all,az/browse/search",
    href_filter=lambda h: "auction" in h.lower(),
)

dump(
    "PublicSurplus (state browse + keyword)",
    "https://www.publicsurplus.com/sms/all,az/browse/search",
    params={"keyWord": "generator", "sortBy": "timeLeft", "page": "1"},
    href_filter=lambda h: "auction" in h.lower(),
)

# ── BidSpotter — show only catalog/lot hrefs ──────────────────────────────────
dump(
    "BidSpotter (keyword search) — catalog+lot hrefs only",
    "https://www.bidspotter.com/en-us/auction-catalogues",
    params={"q": "generator", "pageNo": 1},
    href_filter=lambda h: "auction-catalogues" in h and h.count("/") >= 5,
)

dump(
    "BidSpotter (category page: generators) — lot hrefs only",
    "https://www.bidspotter.com/en-us/for-sale/industrial-and-commercial/generators",
    href_filter=lambda h: "/lots/" in h or ("/en-us/" in h and h.count("/") >= 5),
)

# ── Iron Planet — show item-like hrefs ────────────────────────────────────────
dump(
    "Iron Planet (keyword search) — item hrefs only",
    "https://www.ironplanet.com/jsp/s/search.ips",
    params={"kw": "generator"},
    href_filter=lambda h: re.search(r"\d{4,}", h) and "ironplanet" not in h,
)

dump(
    "Iron Planet (category: generators) — item hrefs only",
    "https://www.ironplanet.com/Generators+and+Power+Equipment",
    params={"ct": "1"},
    href_filter=lambda h: re.search(r"\d{4,}", h) and "ironplanet" not in h,
)
