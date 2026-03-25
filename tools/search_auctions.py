#!/usr/bin/env python3
"""Search PublicSurplus and Iron Planet for auction listings.

Usage:
    python tools/search_auctions.py --state AZ --zip 85001 --radius 100 --keywords "tools" --max 5

Output: JSON array of {url, title, site} to stdout.
"""

import argparse
import json
import re
import sys

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print(json.dumps([]))
    print("Missing deps: pip install requests beautifulsoup4", file=sys.stderr)
    sys.exit(1)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

# ── PublicSurplus category map ─────────────────────────────────────────────────
# catid values scraped from https://www.publicsurplus.com/sms/browse/allcat
_PS_CAT = {
    "tools":         [1009, 619],        # Building/Tools, Industrial/Tools
    "laptop":        [106],              # Computers/Notebooks
    "computer":      [101, 103, 106],    # Computers/General, PC Systems, Notebooks
    "electronics":   [201, 2],           # Electronics/General, Electronics
    "generator":     [616],              # Industrial/Power Plant
    "furniture":     [1401, 301],        # Furniture/General, Office/General
    "medical":       [2308, 612, 2301],  # Medical/General, Industrial/Medical, Lab
    "hvac":          [1004, 1003],       # Building/A/C, Building/Heating
    "treadmill":     [503],              # Sporting Goods/Exercise
    "exercise":      [503],              # Sporting Goods/Exercise
    "guitar":        [1301, 1302],       # Music/General, Music/Orchestra
    "piano":         [1303],             # Music/Pianos
    "music":         [1301],             # Music/General
    "mower":         [1203],             # Outdoor/Lawn and Garden
    "lawn":          [1203],             # Outdoor/Lawn and Garden
    "floor scrubber":[601, 912],         # Industrial/General, School/Janitorial
    "janitorial":    [912, 601],         # School/Janitorial, Industrial/General
    "forklift":      [1717],             # Heavy Equipment/Forklifts
    "truck":         [404, 1714],        # Motor Pool/Truck, Heavy Equip/Trucks
    "vehicle":       [403, 404, 405],    # Motor Pool/Auto, Truck, SUV
    "office":        [301, 303, 302],    # Office/General, Desks, Chairs
    "phone":         [207],              # Electronics/Phones
    "appliance":     [208],              # Electronics/Appliances
}


def _ps_catids_for_keyword(keywords: str) -> list[int]:
    """Return up to 2 category IDs for the given keyword string."""
    kw = keywords.lower().strip()
    # exact match first
    if kw in _PS_CAT:
        return _PS_CAT[kw][:2]
    # partial match
    for key, ids in _PS_CAT.items():
        if key in kw or kw in key:
            return ids[:2]
    return []


def search_publicsurplus(keywords: str, zip_code: str, radius: int, max_results: int) -> list[dict]:
    """Browse PublicSurplus category pages using Playwright."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("Playwright not installed: pip install playwright && python -m playwright install chromium", file=sys.stderr)
        return []

    catids = _ps_catids_for_keyword(keywords)
    if not catids:
        print(f"PublicSurplus: no category mapping for '{keywords}'", file=sys.stderr)
        return []

    results = []
    seen = set()

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)

            for catid in catids:
                if len(results) >= max_results:
                    break

                page = browser.new_page()
                url = f"https://www.publicsurplus.com/sms/browse/cataucs?catid={catid}"
                page.goto(url, wait_until="networkidle", timeout=30000)
                page.wait_for_timeout(2000)

                # Grab each auction card: title, price, location, time left
                items = page.eval_on_selector_all(
                    "a[href*='/auction/view']",
                    """els => els.map(e => {
                        const card = e.closest('.auction-item, .ps-card, .card, li, tr') || e.parentElement;
                        const cardText = card ? card.innerText : '';
                        const priceMatch = cardText.match(/\\$[\\d,]+(?:\\.\\d{2})?/);
                        const lines = cardText.split('\\n').map(l => l.trim()).filter(Boolean);
                        return {
                            href: e.getAttribute('href'),
                            text: (e.innerText || e.textContent || '').trim(),
                            price: priceMatch ? priceMatch[0] : '',
                            card_text: lines.slice(0, 6).join(' | ')
                        };
                    })"""
                )

                for item in items:
                    href = item.get("href", "")
                    title = item.get("text", "").strip()
                    price = item.get("price", "")
                    card_text = item.get("card_text", "")
                    if not href or "/auction/view" not in href:
                        continue
                    full_url = "https://www.publicsurplus.com" + href if not href.startswith("http") else href
                    auc_id = re.search(r"auc=(\d+)", full_url)
                    key = auc_id.group(1) if auc_id else full_url
                    if key in seen:
                        continue
                    seen.add(key)
                    if len(title) < 4:
                        title = f"Auction {key}"
                    results.append({
                        "url": full_url,
                        "title": title,
                        "price": price,
                        "details": card_text,
                        "site": "publicsurplus",
                    })
                    if len(results) >= max_results:
                        break

                page.close()

            browser.close()

    except Exception as e:
        print(f"PublicSurplus error: {e}", file=sys.stderr)

    if not results:
        print(f"PublicSurplus: 0 results for '{keywords}' (catids={catids})", file=sys.stderr)
    return results


# ── Iron Planet ────────────────────────────────────────────────────────────────

_IP_CATEGORY_MAP = [
    (["generator", "power equipment", "genset"],         "/Generators+and+Power+Equipment"),
    (["truck", "trailer", "pickup"],                      "/Trucks+%26+Trailers"),
    (["forklift", "warehouse", "pallet"],                 "/Forklifts+and+Warehouse+Equipment"),
    (["mower", "tractor", "farm", "lawn", "garden"],      "/Agriculture"),
    (["crane"],                                            "/Cranes"),
    (["excavator", "dozer", "loader", "skid steer"],      "/Construction"),
]

_IP_SKIP = {"laptop", "computer", "notebook", "phone", "tablet",
             "furniture", "chair", "desk", "couch", "sofa",
             "guitar", "piano", "violin", "drum",
             "treadmill", "dumbbell", "weights"}

_ITEM_RE = re.compile(r"^/for-sale/[^/?#]+/\d+")


def _ip_parse_items(soup, max_results, filter_words=None):
    results = []
    seen = set()
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if not _ITEM_RE.match(href):
            continue
        clean = "https://www.ironplanet.com" + href.split("?")[0]
        if clean in seen:
            continue
        seen.add(clean)
        title = a.get_text(strip=True)
        if len(title) < 6:
            slug = href.split("?")[0].rsplit("/", 2)[-2]
            title = re.sub(r"-?%28.*?%29-?", " ", slug).replace("-", " ").strip()
        if len(title) <= 5:
            continue
        if filter_words and not any(w in title.lower() for w in filter_words):
            continue
        results.append({"url": clean, "title": title, "site": "ironplanet"})
        if len(results) >= max_results:
            break
    return results


def search_ironplanet(keywords: str, max_results: int) -> list[dict]:
    kw_split = set(re.split(r"\W+", keywords.lower()))
    if kw_split & _IP_SKIP:
        return []

    kw = keywords.lower()
    kw_words = [w for w in re.split(r"\W+", kw) if len(w) > 2]

    category_path = None
    for terms, path in _IP_CATEGORY_MAP:
        if any(t in kw for t in terms):
            category_path = path
            break

    if category_path:
        try:
            r = requests.get("https://www.ironplanet.com" + category_path, headers=HEADERS, timeout=20)
            r.raise_for_status()
            results = _ip_parse_items(BeautifulSoup(r.text, "html.parser"), max_results)
            if results:
                return results
        except Exception as e:
            print(f"Iron Planet category error: {e}", file=sys.stderr)

    try:
        r = requests.get("https://www.ironplanet.com/jsp/s/search.ips",
                         params={"kw": keywords}, headers=HEADERS, timeout=20)
        r.raise_for_status()
        results = _ip_parse_items(BeautifulSoup(r.text, "html.parser"), max_results, filter_words=kw_words)
        if results:
            return results
    except Exception as e:
        print(f"Iron Planet search error: {e}", file=sys.stderr)

    print(f"Iron Planet: 0 results for '{keywords}'", file=sys.stderr)
    return []


# ── CLI ────────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--state",    required=True)
    p.add_argument("--zip",      default="85001")
    p.add_argument("--radius",   type=int, default=100)
    p.add_argument("--category", default="")
    p.add_argument("--keywords", default="")
    p.add_argument("--max",      type=int, default=5)
    args = p.parse_args()

    term = args.keywords or args.category
    if not term:
        print("Provide --keywords or --category", file=sys.stderr)
        sys.exit(1)

    results = []
    results += search_publicsurplus(term, args.zip, args.radius, args.max)
    results += search_ironplanet(term, args.max)

    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
