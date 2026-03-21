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


def search_govdeals(state: str, keywords: str, max_results: int) -> list[dict]:
    """Search GovDeals using Playwright (site requires JavaScript rendering)."""
    results = []
    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
    except ImportError:
        print("GovDeals search skipped: playwright not installed (run: python -m playwright install chromium)", file=sys.stderr)
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
                headless=False,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--window-size=1920,1080",
                ],
            )
            context = browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1920, "height": 1080},
                locale="en-US",
            )
            page = context.new_page()

            # Remove the webdriver flag that bot detectors look for
            page.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

            page.goto(search_url, timeout=30000, wait_until="domcontentloaded")
            time.sleep(15)  # Wait for Angular SPA to render search results

            # Check if we got blocked
            if "Access Denied" in (page.title() or ""):
                print("GovDeals: blocked by bot detection (Access Denied)", file=sys.stderr)
                browser.close()
                return results

            # Wait for asset links to appear (GovDeals uses /en/asset/ not /en/auction/)
            try:
                page.wait_for_selector("a[href*='/en/asset/']", timeout=15000)
            except PlaywrightTimeout:
                print("GovDeals: timed out waiting for results", file=sys.stderr)
                browser.close()
                return results

            seen = set()
            for a in page.query_selector_all("a[href*='/en/asset/']"):
                href = a.get_attribute("href") or ""
                if not href.startswith("http"):
                    href = "https://www.govdeals.com" + href
                if href not in seen:
                    seen.add(href)
                    title = (a.inner_text() or "").strip()
                    if len(title) > 5:
                        results.append({"url": href, "title": title, "site": "govdeals"})
                        if len(results) >= max_results:
                            break

            browser.close()
    except Exception as e:
        print(f"GovDeals search error: {e}", file=sys.stderr)

    return results


def search_publicsurplus(state: str, keywords: str, max_results: int) -> list[dict]:
    results = []
    try:
        params = {
            "ac": "1",
            "fn": "search",
            "searchstate": state,
            "searchterm": keywords,
            "searchdist": "500",
        }
        r = requests.get(
            "https://www.publicsurplus.com/sms/browse/home",
            params=params,
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

    # Build search term: prefer explicit keywords, fall back to category
    term = args.keywords or args.category

    results = []
    results += search_govdeals(args.state, term, args.max)
    time.sleep(0.5)
    results += search_publicsurplus(args.state, term, args.max)

    print(json.dumps(results))


if __name__ == "__main__":
    main()
