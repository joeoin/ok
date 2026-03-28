#!/usr/bin/env python3
"""
PublicSurplus deal-finder agent.

Scrapes listings closing within 72 hours near zip 85001 (100mi radius),
uses Claude AI to build smart eBay search queries, looks up eBay sold comps,
and surfaces only deals with profit_ratio >= 1.8x AND minimum $100 profit.

Usage:
    python tools/search_auctions.py
    python tools/search_auctions.py --zip 85260 --radius 100 --hours 24 --min-ratio 1.8 --max 10
"""

import argparse
import json
import os
import re
import sys
import time

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    sys.exit("Missing deps: pip install requests beautifulsoup4")

# Load .env if present (search in script dir and project root)
for _env_candidate in [
    os.path.join(os.path.dirname(__file__), ".env"),
    os.path.join(os.path.dirname(__file__), "..", ".env"),
]:
    if os.path.exists(_env_candidate):
        with open(_env_candidate) as _f:
            for _line in _f:
                _line = _line.strip()
                if _line and not _line.startswith("#") and "=" in _line:
                    _k, _v = _line.split("=", 1)
                    os.environ.setdefault(_k.strip(), _v.strip())
        break


# ── Claude API query builder ───────────────────────────────────────────────────

def build_ebay_query(item_title: str, item_description: str = "") -> str:
    """
    Use Claude API (Haiku — fast + cheap) to extract key identifiers from a
    listing title/description and return a precise eBay sold-listings query.
    Falls back to a simple keyword strip if the API key is missing.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        # Fallback: strip stop-words and return first 6 meaningful words
        words = [w for w in re.split(r"\W+", item_title) if len(w) > 2][:6]
        return " ".join(words)

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)

        prompt = f"""You are helping find resale prices for government surplus auction items.

Item title: {item_title}
Item description: {item_description[:500] if item_description else "(none)"}

Extract the most searchable identifiers from this item and return a 5-8 word eBay search query.
Focus on: brand name, model number/name, key specifications, item type.
Remove filler words like "lot", "unit", "used", "auction", county/city names.
Return ONLY the search query string, nothing else."""

        message = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=64,
            messages=[{"role": "user", "content": prompt}],
        )
        query = message.content[0].text.strip().strip('"').strip("'")
        # Limit to 8 words
        words = query.split()[:8]
        return " ".join(words)
    except Exception as e:
        print(f"Claude query build failed: {e}", file=sys.stderr)
        words = [w for w in re.split(r"\W+", item_title) if len(w) > 2][:6]
        return " ".join(words)


# ── eBay sold listings price lookup ───────────────────────────────────────────

def get_ebay_sold_comps(query: str) -> dict:
    """
    Search eBay sold/completed listings for the given query using Playwright.
    Returns median, avg, low, high, count.
    """
    from playwright.sync_api import sync_playwright
    from urllib.parse import quote_plus

    if not query:
        return {"prices": [], "avg": 0, "median": 0, "count": 0, "query": query}

    url = (
        f"https://www.ebay.com/sch/i.html"
        f"?_nkw={quote_plus(query)}&LH_Sold=1&LH_Complete=1&_sop=13"
    )

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            ctx = browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            )
            page = ctx.new_page()
            page.goto(url, wait_until="load", timeout=30000)
            try:
                page.wait_for_selector(".s-item__price", timeout=8000)
            except Exception:
                pass
            page.wait_for_timeout(1000)

            prices_raw = page.eval_on_selector_all(
                ".s-item__price",
                "els => els.map(e => e.innerText.trim())"
            )
            browser.close()

        prices = []
        for text in prices_raw:
            # Handle ranges like "$50.00 to $75.00" — take the lower value
            m = re.search(r"\$([\d,]+(?:\.\d{2})?)", text)
            if m:
                try:
                    val = float(m.group(1).replace(",", ""))
                    if 0.99 < val < 50000:
                        prices.append(val)
                except ValueError:
                    pass

        if not prices:
            return {"prices": [], "avg": 0, "median": 0, "count": 0, "query": query}

        prices.sort()
        avg = sum(prices) / len(prices)
        median = prices[len(prices) // 2]
        return {
            "prices": prices,
            "avg": round(avg, 2),
            "median": round(median, 2),
            "low": round(prices[0], 2),
            "high": round(prices[-1], 2),
            "count": len(prices),
            "query": query,
            "source": "ebay_sold",
        }
    except Exception as e:
        print(f"eBay lookup failed for '{query}': {e}", file=sys.stderr)
        return {"prices": [], "avg": 0, "median": 0, "count": 0, "query": query}


# ── Facebook Marketplace fallback ─────────────────────────────────────────────

def get_fb_comps(title: str) -> dict:
    """Search Facebook Marketplace for current listing prices near Phoenix AZ (fallback)."""
    from playwright.sync_api import sync_playwright
    from urllib.parse import quote_plus

    words = [w for w in re.split(r"\W+", title) if len(w) > 2][:5]
    query = " ".join(words)
    if not query:
        return {"prices": [], "avg": 0, "count": 0, "query": query}

    email = os.environ.get("FB_EMAIL", "")
    password = os.environ.get("FB_PASSWORD", "")
    if not email or not password:
        return {"prices": [], "avg": 0, "count": 0, "query": query}

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            ctx = browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            )
            page = ctx.new_page()

            page.goto("https://www.facebook.com/login", wait_until="load", timeout=30000)
            page.wait_for_selector("input[name='email']", timeout=10000)
            page.fill("input[name='email']", email)
            page.fill("input[name='pass']", password)
            page.press("input[name='pass']", "Enter")
            page.wait_for_timeout(5000)

            if "login" in page.url or "checkpoint" in page.url:
                print(f"FB login failed — still on: {page.url}", file=sys.stderr)
                browser.close()
                return {"prices": [], "avg": 0, "count": 0, "query": query}

            url = f"https://www.facebook.com/marketplace/phoenix/search?query={quote_plus(query)}&exact=false"
            page.goto(url, wait_until="load", timeout=30000)
            page.wait_for_timeout(3000)

            prices_raw = page.eval_on_selector_all(
                "span[dir='auto']",
                "els => els.map(e => e.innerText.trim()).filter(t => t.startsWith('$'))"
            )
            browser.close()

        prices = []
        for text in prices_raw:
            m = re.search(r"\$([\d,]+(?:\.\d{2})?)", text)
            if m:
                try:
                    val = float(m.group(1).replace(",", ""))
                    if 0.99 < val < 50000:
                        prices.append(val)
                except ValueError:
                    pass

        if not prices:
            return {"prices": [], "avg": 0, "count": 0, "query": query}

        prices.sort()
        avg = sum(prices) / len(prices)
        median = prices[len(prices) // 2]
        return {
            "prices": prices,
            "avg": round(avg, 2),
            "median": round(median, 2),
            "low": prices[0],
            "high": prices[-1],
            "count": len(prices),
            "query": query,
            "source": "facebook_marketplace",
        }
    except Exception as e:
        print(f"FB lookup failed for '{title}': {e}", file=sys.stderr)
        return {"prices": [], "avg": 0, "count": 0, "query": query}


# ── PublicSurplus scraper ──────────────────────────────────────────────────────

def scrape_publicsurplus(zip_code: str, radius: int, hours: int, max_listings: int) -> list[dict]:
    """Scrape PublicSurplus for listings closing within `hours` hours near zip_code."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit("Missing dep: pip install playwright && python -m playwright install chromium")

    listings = []
    seen = set()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        url = (
            "https://www.publicsurplus.com/sms/browse/search"
            f"?posting=y&page=1&sortBy=timeLeft"
            f"&endHours={hours}&startHours=-1"
            f"&lowerPrice=&higherPrice="
            f"&milesLocation={radius}&zipCode={zip_code}"
            f"&region=&search=Search"
        )
        print(f"Scraping PublicSurplus: {url}", file=sys.stderr)
        page.goto(url, wait_until="networkidle", timeout=30000)
        page.wait_for_timeout(2000)

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
                    card_lines: lines
                };
            })"""
        )

        browser.close()

    for item in items:
        href = item.get("href", "")
        if not href or "/auction/view" not in href:
            continue
        full_url = "https://www.publicsurplus.com" + href if not href.startswith("http") else href
        auc_id = re.search(r"auc=(\d+)", full_url)
        key = auc_id.group(1) if auc_id else full_url
        if key in seen:
            continue
        seen.add(key)

        card_lines = item.get("card_lines", [])
        card_text = " | ".join(card_lines[:8])

        # Extract title from card
        name_match = re.search(r"#\d+ - (.+?)(?:\s*\||\s*$)", card_text)
        title = name_match.group(1).strip().title() if name_match else item.get("text", "").strip()
        if not title or len(title) < 3:
            continue

        # Extract price
        price_str = item.get("price", "")
        price_match = re.search(r"\$([\d,]+(?:\.\d{2})?)", price_str)
        price = float(price_match.group(1).replace(",", "")) if price_match else 0.0

        # Extract time remaining
        time_left = ""
        for line in card_lines:
            if re.search(r"hour|day|min", line, re.I) and re.search(r"\d+", line):
                time_left = line.strip()
                break

        # Extract location/state abbreviation
        location = ""
        for line in card_lines:
            if re.match(r"^[A-Z]{2}$", line.strip()):
                location = line.strip()
                break

        # Extract bids
        bids = 0
        for line in card_lines:
            bm = re.search(r"(\d+)\s*bid", line, re.I)
            if bm:
                bids = int(bm.group(1))
                break

        listings.append({
            "id": key,
            "title": title,
            "url": full_url,
            "price": price,
            "price_str": price_str or f"${price:.2f}",
            "time_left": time_left,
            "bids": bids,
            "location": location,
            "card_text": card_text,
        })

        if len(listings) >= max_listings:
            break

    print(f"Found {len(listings)} listings closing within {hours}h near {zip_code}", file=sys.stderr)

    # Deduplicate by normalized title
    seen_titles: set = set()
    unique = []
    for lst in listings:
        norm = re.sub(r"\W+", " ", lst["title"].lower()).strip()
        if norm not in seen_titles:
            seen_titles.add(norm)
            unique.append(lst)
    print(f"After dedup: {len(unique)} unique listings", file=sys.stderr)
    return unique


# ── Listing detail scraper ────────────────────────────────────────────────────

def get_listing_details(url: str) -> dict:
    """Visit a PublicSurplus listing page and extract full item details."""
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(url, wait_until="load", timeout=30000)
            page.wait_for_timeout(1500)

            details = page.eval_on_selector_all("*", """els => {
                const get = sel => {
                    const el = document.querySelector(sel);
                    return el ? el.innerText.trim() : '';
                };
                return {
                    title: get('h1, h2, .auction-title, [class*="title"]'),
                    description: get('.auction-description, [class*="desc"], #description, .item-desc'),
                    condition: get('[class*="condition"], [class*="status"]'),
                    location: get('[class*="location"], [class*="pickup"], [class*="agency"]'),
                    photos: document.querySelectorAll('img[src*="auction"], img[src*="photo"], img[src*="img"]').length
                };
            }""")
            browser.close()
            return details[0] if details else {}
    except Exception:
        return {}


# ── Deal analyzer ─────────────────────────────────────────────────────────────

def analyze_deals(listings: list[dict], min_ratio: float, min_profit: float) -> list[dict]:
    """
    For each listing:
    1. Get full listing details (title + description) from the item page
    2. Build a smart eBay query using Claude API
    3. Look up eBay sold comps
    4. Fall back to Facebook Marketplace if eBay returns nothing
    5. Filter by min_ratio AND min_profit
    """
    deals = []
    total = len(listings)
    has_anthropic = bool(os.environ.get("ANTHROPIC_API_KEY"))
    has_fb = bool(os.environ.get("FB_EMAIL")) and bool(os.environ.get("FB_PASSWORD"))

    if not has_anthropic:
        print("Note: ANTHROPIC_API_KEY not set — using simple keyword extraction for queries", file=sys.stderr)
    if not has_fb:
        print("Note: FB_EMAIL/FB_PASSWORD not set — Facebook Marketplace fallback disabled", file=sys.stderr)

    for i, listing in enumerate(listings):
        price = listing["price"]
        if price <= 0:
            print(f"[{i+1}/{total}] SKIP (no price): {listing['title']}", file=sys.stderr)
            continue

        # Step 1: Get listing details for better title + description
        print(f"[{i+1}/{total}] Fetching details: {listing['title']}", file=sys.stderr)
        details = get_listing_details(listing["url"])

        full_title = details.get("title", "") or listing["title"]
        if len(full_title) < 4:
            full_title = listing["title"]
        description = details.get("description", "")
        listing["title"] = full_title
        listing["description"] = description
        listing["condition"] = details.get("condition", "")
        listing["pickup_location"] = details.get("location", listing.get("location", "AZ"))
        listing["photo_count"] = details.get("photos", 0)

        # Step 2: Build smart eBay query with Claude
        print(f"[{i+1}/{total}] Building query for: {full_title}", file=sys.stderr)
        ebay_query = build_ebay_query(full_title, description)
        print(f"[{i+1}/{total}] eBay query: \"{ebay_query}\"", file=sys.stderr)

        # Step 3: eBay sold listings (primary)
        comps = get_ebay_sold_comps(ebay_query)
        source = "ebay_sold"

        # Step 4: FB Marketplace fallback
        if comps["count"] < 3 and has_fb:
            print(f"[{i+1}/{total}] eBay returned {comps['count']} comps — trying Facebook Marketplace", file=sys.stderr)
            fb = get_fb_comps(full_title)
            if fb["count"] > comps["count"]:
                comps = fb
                source = "facebook_marketplace"

        if comps["count"] == 0:
            print(f"[{i+1}/{total}] No comps found — skipping", file=sys.stderr)
            continue

        # Use median as conservative estimate (less affected by outliers)
        resale = comps.get("median", 0) or comps.get("avg", 0)
        risk_flags = []

        # Apply condition discount
        card_lower = (listing.get("card_text", "") + " " + description).lower()
        if any(w in card_lower for w in ["as-is", "as is", "untested", "for parts", "unknown condition", "non-working"]):
            resale *= 0.70
            risk_flags.append("AS-IS / Condition risk (-30% applied)")

        profit_ratio = resale / price if price > 0 else 0
        est_profit = resale - price

        if profit_ratio < min_ratio or est_profit < min_profit:
            print(f"[{i+1}/{total}] Below threshold: ratio={profit_ratio:.2f}x profit=${est_profit:.0f}", file=sys.stderr)
            continue

        confidence = "HIGH" if comps["count"] >= 5 else ("MED" if comps["count"] >= 3 else "LOW")
        print(f"[{i+1}/{total}] DEAL FOUND: {full_title} — {profit_ratio:.1f}x (${est_profit:.0f} profit)", file=sys.stderr)

        deals.append({
            **listing,
            "comps_avg": comps["avg"],
            "comps_median": comps.get("median", 0),
            "comps_low": comps.get("low", 0),
            "comps_high": comps.get("high", 0),
            "comps_count": comps["count"],
            "comps_query": comps["query"],
            "comps_source": source,
            "resale_estimate": round(resale, 2),
            "profit_ratio": round(profit_ratio, 2),
            "est_profit": round(est_profit, 2),
            "confidence": confidence,
            "risk_flags": risk_flags,
        })

    deals.sort(key=lambda x: x["profit_ratio"], reverse=True)
    return deals


# ── Output formatting ──────────────────────────────────────────────────────────

def format_deals(deals: list[dict]) -> str:
    if not deals:
        return "No deals found meeting the 1.8x profit ratio + $100 minimum profit threshold.\n"

    lines = []
    for i, d in enumerate(deals, 1):
        risk_str = ", ".join(d["risk_flags"]) if d["risk_flags"] else "None"
        recommend = (
            "BUY" if d["profit_ratio"] >= 2.5 and d["confidence"] != "LOW"
            else "WATCH" if d["profit_ratio"] >= 1.8
            else "SKIP"
        )
        source_label = "eBay Sold Listings" if d["comps_source"] == "ebay_sold" else "Facebook Marketplace Phoenix"
        lines.append(f"""
--- DEAL #{i} ---
TITLE:           {d['title']}
URL:             {d['url']}
CURRENT PRICE:   {d['price_str']}
TIME REMAINING:  {d['time_left']}
BIDS:            {d['bids']}
LOCATION:        {d.get('pickup_location', d.get('location', 'AZ'))}

RESALE COMPS ({source_label} — "{d['comps_query']}"):
  Avg:    ${d['comps_avg']:,.0f}
  Median: ${d['comps_median']:,.0f}
  Range:  ${d['comps_low']:,.0f} – ${d['comps_high']:,.0f}
  Comps:  {d['comps_count']} listings
  Est. resale value: ${d['resale_estimate']:,.0f}

PROFIT RATIO:    {d['profit_ratio']:.1f}x
EST. PROFIT:     ${d['est_profit']:,.0f}
CONFIDENCE:      {d['confidence']}
RISK FLAGS:      {risk_str}
RECOMMENDATION:  {recommend}
""")

    # Summary table
    lines.append("\n" + "="*80)
    lines.append("SUMMARY TABLE")
    lines.append("="*80)
    lines.append(f"{'#':<4} {'Item':<36} {'Bid':>8} {'Resale':>8} {'Ratio':>7}  {'Rec':<6} {'Time Left'}")
    lines.append("-"*90)
    for i, d in enumerate(deals, 1):
        recommend = (
            "BUY" if d["profit_ratio"] >= 2.5 and d["confidence"] != "LOW"
            else "WATCH"
        )
        lines.append(
            f"{i:<4} {d['title'][:35]:<36} {d['price_str']:>8} "
            f"${d['resale_estimate']:>7,.0f} {d['profit_ratio']:>6.1f}x  {recommend:<6} {d['time_left'][:20]}"
        )

    # Top pick
    top = deals[0]
    lines.append(f"\n{'='*80}")
    lines.append(f"TOP PICK: {top['title']}")
    lines.append(f"  Bid at ${top['price']:.0f}, resells for ~${top['resale_estimate']:.0f} on "
                 f"{'eBay' if top['comps_source'] == 'ebay_sold' else 'FB Marketplace'} — "
                 f"{top['profit_ratio']:.1f}x return (~${top['est_profit']:.0f} profit)")
    lines.append(f"  {top['url']}")

    return "\n".join(lines)


# ── CLI ────────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--zip",        default="85001",  help="ZIP code (default: 85001 Phoenix AZ)")
    p.add_argument("--radius",     type=int, default=100)
    p.add_argument("--hours",      type=int, default=72,    help="Max hours until closing (default 72)")
    p.add_argument("--min-ratio",  type=float, default=1.8, help="Min profit ratio (default 1.8)")
    p.add_argument("--min-profit", type=float, default=100.0, help="Min dollar profit (default $100)")
    p.add_argument("--max",        type=int,   default=50,  help="Max listings to scrape")
    p.add_argument("--json",       action="store_true",     help="Output raw JSON instead of formatted text")
    args = p.parse_args()

    listings = scrape_publicsurplus(args.zip, args.radius, args.hours, args.max)
    if not listings:
        print("No listings found. Try --hours 168 to widen to 7 days.")
        sys.exit(0)

    print(f"\nAnalyzing {len(listings)} listings for {args.min_ratio}x ratio + ${args.min_profit:.0f} min profit...\n", file=sys.stderr)
    deals = analyze_deals(listings, args.min_ratio, args.min_profit)

    if args.json:
        print(json.dumps(deals, indent=2))
    else:
        print(format_deals(deals))


if __name__ == "__main__":
    main()
