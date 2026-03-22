#!/usr/bin/env python3
"""Search GovDeals and PublicSurplus for auction listings.

Usage:
    python tools/search_auctions.py --state AZ --category "Tools & Equipment" --max 3
    python tools/search_auctions.py --state AZ --keywords "generator" --max 3

Output: JSON array of {url, title, site} to stdout.
Errors go to stderr; script exits 0 with partial results if one site fails.
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


def search_govdeals_api(state: str, keywords: str, max_results: int) -> list[dict]:
    """Try GovDeals via their internal JSON API (no browser needed)."""
    results = []
    try:
        r = requests.get(
            "https://www.govdeals.com/api/v2/search",
            params={
                "keyword": keywords,
                "state": state,
                "pageSize": max_results * 3,
                "sortBy": "endDateAsc",
            },
            headers={
                **HEADERS,
                "Accept": "application/json, text/plain, */*",
                "Referer": "https://www.govdeals.com/",
                "X-Requested-With": "XMLHttpRequest",
            },
            timeout=15,
        )
        # Only proceed if we actually got JSON back
        ct = r.headers.get("Content-Type", "")
        if r.status_code == 200 and "json" in ct:
            data = r.json()
            # Response is {"assets": [...]} or {"results": [...]} — try both
            items = data.get("assets") or data.get("results") or data.get("items") or []
            for item in items[:max_results]:
                asset_id = item.get("assetId") or item.get("id") or item.get("assetNumber", "")
                seller_id = item.get("sellerId") or item.get("agencyId") or ""
                title = item.get("title") or item.get("name") or item.get("description", "")
                if asset_id and title:
                    url = f"https://www.govdeals.com/en/asset/{asset_id}/{seller_id}"
                    results.append({"url": url, "title": title.strip(), "site": "govdeals"})
            if results:
                return results
        print(f"GovDeals API: status {r.status_code}, content-type '{ct}' — trying Playwright", file=sys.stderr)
    except Exception as e:
        print(f"GovDeals API error: {e} — trying Playwright", file=sys.stderr)
    return results


def search_govdeals_playwright(state: str, keywords: str, max_results: int) -> list[dict]:
    """Fallback: scrape GovDeals with a real browser (requires playwright install)."""
    results = []
    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
    except ImportError:
        print("GovDeals Playwright skipped: run 'pip install playwright && playwright install chromium'", file=sys.stderr)
        return results

    search_url = (
        f"https://www.govdeals.com/en/search"
        f"?keyword={requests.utils.quote(keywords)}"
        f"&state={state}"
        f"&pageSize={max_results * 3}"
        f"&sortBy=endDateAsc"
    )

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                headless=True,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                ],
            )
            context = browser.new_context(
                user_agent=HEADERS["User-Agent"],
                viewport={"width": 1920, "height": 1080},
                locale="en-US",
            )
            page = context.new_page()
            page.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
            )
            page.goto(search_url, timeout=30000, wait_until="domcontentloaded")

            if "Access Denied" in (page.title() or "") or "blocked" in page.url.lower():
                print("GovDeals Playwright: blocked by bot detection", file=sys.stderr)
                browser.close()
                return results

            try:
                page.wait_for_selector("a[href*='/en/asset/']", timeout=20000)
            except PlaywrightTimeout:
                print("GovDeals Playwright: timed out waiting for results", file=sys.stderr)
                browser.close()
                return results

            best = {}
            for a in page.query_selector_all("a[href*='/en/asset/']"):
                href = a.get_attribute("href") or ""
                if not href.startswith("http"):
                    href = "https://www.govdeals.com" + href
                title = (a.inner_text() or "").strip()
                if len(title) > 5 and title.upper() != "ONLINE AUCTION" and href not in best:
                    best[href] = title

            for href, title in list(best.items())[:max_results]:
                results.append({"url": href, "title": title, "site": "govdeals"})

            browser.close()
    except Exception as e:
        print(f"GovDeals Playwright error: {e}", file=sys.stderr)

    return results


def search_govdeals(state: str, keywords: str, max_results: int) -> list[dict]:
    """Search GovDeals: tries API first, falls back to Playwright."""
    results = search_govdeals_api(state, keywords, max_results)
    if not results:
        results = search_govdeals_playwright(state, keywords, max_results)
    if not results:
        print(f"GovDeals: 0 results for '{keywords}' in {state}", file=sys.stderr)
    return results


def search_publicsurplus(state: str, keywords: str, max_results: int) -> list[dict]:
    results = []
    try:
        r = requests.get(
            "https://www.publicsurplus.com/sms/browse/home",
            params={
                "ac": "1",
                "fn": "search",
                "searchstate": state,
                "searchterm": keywords,
                "searchdist": "500",
            },
            headers=HEADERS,
            timeout=20,
        )
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")

        seen = set()
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if "/auction/view" in href:
                if not href.startswith("http"):
                    href = "https://www.publicsurplus.com" + href
                if href not in seen:
                    seen.add(href)
                    title = a.get_text(strip=True)
                    if len(title) > 5:
                        results.append({"url": href, "title": title, "site": "publicsurplus"})
                        if len(results) >= max_results:
                            break
        if not results:
            print(f"PublicSurplus: 0 results for '{keywords}' in {state}", file=sys.stderr)
    except Exception as e:
        print(f"PublicSurplus search error: {e}", file=sys.stderr)
    return results


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--state", required=True, help="Two-letter state code, e.g. AZ")
    p.add_argument("--category", default="", help="Item category")
    p.add_argument("--keywords", default="", help="Search keywords (overrides category if both given)")
    p.add_argument("--max", type=int, default=3, help="Max results per site")
    args = p.parse_args()

    term = args.keywords or args.category

    results = []
    results += search_govdeals(args.state, term, args.max)
    time.sleep(0.5)
    results += search_publicsurplus(args.state, term, args.max)

    print(json.dumps(results))


if __name__ == "__main__":
    main()
