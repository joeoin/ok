"""
GovDeals Arbitrage Agent

Finds government surplus auction items on GovDeals.com within your area
and lists them on Facebook Marketplace at 80% markup to test demand before bidding.

Workflow:
    1. Searches GovDeals.com for items near you based on config.json
    2. Checks approximate market value — skips items where 80% markup
       would price them above what they actually sell for
    3. Prints formatted FB Marketplace listings (using GovDeals photos)
    4. Asks which items to post (each one, or all at once)
    5. Posts approved items to Facebook Marketplace via browser automation
    6. If people message you on Facebook -> go bid on GovDeals yourself

Requirements:
    pip install claude-agent-sdk anyio
    npx @playwright/mcp@latest   (only needed with --post)

Setup:
    1. Edit config.json — set your_city_state and your zip code
    2. If using --post, make sure you are logged into Facebook in the browser

Usage:
    python agent.py              # Scan GovDeals, print listings
    python agent.py --post       # Scan, confirm each item, then post to Facebook
"""

import anyio
import json
import os
import sys

from claude_agent_sdk import query, ClaudeAgentOptions, ResultMessage, SystemMessage, AssistantMessage


CACHE_PATH = "found_items.json"

DEFAULT_CONFIG = {
    "markup_percent": 80,
    "max_listings_per_search": 3,
    "your_city_state": "Phoenix, AZ",
    "your_zip": "85001",
    "radius_miles": 100,
    "state": "AZ",
    "max_bid": 1500,
    "max_daily_posts": 5,
    "searches": [
        {"keywords": "", "category": "Tools & Equipment"},
        {"keywords": "", "category": "Electronics & Computers"},
        {"keywords": "", "category": "Generators & Power Equipment"}
    ]
}


def load_cache() -> dict:
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH, encoding="utf-8") as f:
            return json.load(f)
    return {"items": []}


def save_to_cache(scan_text: str, cache: dict) -> dict:
    """Parse the agent's JSON block from scan output and merge into cache."""
    import re
    match = re.search(r"```json\s*(\{.*?\})\s*```", scan_text, re.DOTALL)
    if not match:
        match = re.search(r"```json\s*(\[.*?\])\s*```", scan_text, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group(1))
            new_items = data if isinstance(data, list) else data.get("items", [])
            existing_urls = {item.get("url", "") for item in cache["items"]}
            added = 0
            for item in new_items:
                if item.get("url") and item["url"] not in existing_urls:
                    cache["items"].append(item)
                    existing_urls.add(item["url"])
                    added += 1
            with open(CACHE_PATH, "w", encoding="utf-8") as f:
                json.dump(cache, f, indent=2)
            print(f"\nCache: added {added} new items, {len(cache['items'])} total in {CACHE_PATH}")
        except json.JSONDecodeError as e:
            print(f"\nWarning: could not parse JSON from agent output: {e}")
    else:
        print("\nWarning: no JSON block found in agent output — nothing cached")
    return cache


def load_config(config_path: str) -> dict:
    if os.path.exists(config_path):
        with open(config_path) as f:
            return json.load(f)
    return DEFAULT_CONFIG


def build_scan_prompt(config: dict, cache: dict) -> str:
    markup = config.get("markup_percent", 80)
    multiplier = 1 + markup / 100
    max_per = config.get("max_listings_per_search", 3)
    your_location = config.get("your_city_state", "Phoenix, AZ")
    your_zip = config.get("your_zip", "85001")
    radius = config.get("radius_miles", 100)
    state = config.get("state", "AZ")
    max_bid = config.get("max_bid", 1500)
    searches = config.get("searches", [])
    cached_urls = [item.get("url", "") for item in cache.get("items", []) if item.get("url")]
    skip_urls_str = "\n".join(f"  - {u}" for u in cached_urls) if cached_urls else "  (none)"

    search_lines = ""
    for i, s in enumerate(searches, 1):
        cat = s.get("category", "All")
        kw = f'  keywords="{s["keywords"]}"' if s.get("keywords") else ""
        search_lines += f"  {i}. Category: {cat}{kw}\n"

    return f"""You are a government surplus auction scanner. Execute these steps in exact order. Do not skip steps. Do not add extra steps.

STEP 1 — WebSearch: govdeals.com {state} tools electronics generators surplus auction site:govdeals.com
STEP 2 — WebSearch: site:publicsurplus.com {state} tools electronics generators auction
STEP 3 — From the search results in steps 1 and 2, pick up to {max_per} item URLs that look like individual lot pages on govdeals.com or publicsurplus.com. Skip these already-found URLs:
{skip_urls_str}
  For each URL you picked: WebFetch it once. If the fetch fails, skip that URL entirely.
STEP 4 — For each successfully fetched item, apply these filters (discard if ANY fail):
  - Pickup location within {radius} miles of {your_zip}
  - Current bid under ${max_bid}
  - Portable item — tools, electronics, generators under 200 lbs
  - NOT a vehicle, trailer, real estate, or heavy equipment
  - Auction end date more than 24 hours from now
STEP 5 — For each item that passed filters: WebSearch "[item name] used price ebay sold"
  - market_value = median sold price from results (estimate if unclear)
  - fb_price = round(market_value * 0.90 / 5) * 5
  - Skip item if fb_price < bid * {multiplier:.2f}
STEP 6 — Output results immediately. Do not do any more searches or fetches after this point.

For each kept item print:
  ITEM: [title] | LOT: [number] | SITE: [site] | URL: [url]
  BID: $X | MARKET: $Y | FB PRICE: $Z | PROFIT: $P | ENDS: [date]
  PICKUP: [city] | PHOTOS: [photo urls if any]
  FB TITLE: [max 100 chars]
  FB DESCRIPTION: [3 sentences describing the item, ending with "Local pickup only — {your_location}"]

Then output this JSON block (required even if items list is empty):

```json
{{
  "items": [
    {{
      "title": "item title", "lot": "lot#", "site": "site", "url": "url",
      "bid": 0, "market_value": 0, "fb_price": 0, "pickup": "City, ST",
      "ends": "2026-03-25", "photos": [], "fb_title": "", "fb_description": "",
      "fb_category": "Tools & Equipment", "fb_condition": "Used - Good"
    }}
  ]
}}
```
"""


def build_post_prompt(config: dict, scan_results: str, items_to_post: str) -> str:
    your_location = config.get("your_city_state", "Phoenix, AZ")
    max_daily_posts = config.get("max_daily_posts", 5)

    return f"""You are a Facebook Marketplace posting agent.

The user has already scanned GovDeals and selected items to post.
Below are the full scan results. Post ONLY the items specified in the selection.

SELECTION: {items_to_post}

SCAN RESULTS:
{scan_results}

## Instructions

For each selected item, post it to Facebook Marketplace:

1. Navigate to https://www.facebook.com/marketplace/create/item
2. **Photos**: Download each GovDeals photo URL to a temp file, then upload all of them.
   Use every photo available from the listing — more photos = more buyer trust.
3. **Title**: Use the FB title from the listing (max 100 chars)
4. **Price**: FB list price as a plain number (no $ sign)
5. **Category**: Closest Facebook Marketplace category
6. **Condition**: As listed (Used - Good unless otherwise noted)
7. **Description**: Use the FB description from the listing
8. **Location**: {your_location}
9. Click "Next" then "Publish"
10. Wait for the success confirmation before starting the next listing

STOP immediately and notify the user if you are not logged into Facebook.
Post a maximum of {max_daily_posts} items total — stop after that even if more were selected.
After all postings, print how many were successfully posted.
"""


async def stream_query(prompt: str, options: ClaudeAgentOptions, log_file=None) -> str:
    """Run a query, print output live, and return the full text."""
    full_text = []
    async for message in query(prompt=prompt, options=options):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if hasattr(block, "text"):
                    print(block.text, end="", flush=True)
                    if log_file:
                        log_file.write(block.text)
                        log_file.flush()
                    full_text.append(block.text)
        elif isinstance(message, ResultMessage):
            print("\n" + message.result)
            if log_file:
                log_file.write("\n" + message.result + "\n")
                log_file.flush()
            full_text.append(message.result)
        elif isinstance(message, SystemMessage) and message.subtype == "init":
            session_id = message.data.get("session_id", "")
            if session_id:
                print(f"Session: {session_id}\n")
    return "".join(full_text)


async def main() -> None:
    args = sys.argv[1:]

    if "-h" in args or "--help" in args:
        print(__doc__)
        sys.exit(0)

    config_path = "config.json"
    if "--config" in args:
        idx = args.index("--config")
        if idx + 1 < len(args):
            config_path = args[idx + 1]

    if not os.path.exists(config_path):
        with open(config_path, "w") as f:
            json.dump(DEFAULT_CONFIG, f, indent=2)
        print("Created config.json")
        print()
        print("Before running, open config.json and update:")
        print("  your_city_state  — your city and state  (e.g. 'Tucson, AZ')")
        print("  your_zip         — your ZIP code        (e.g. '85701')")
        print("  radius_miles     — pickup radius        (default 100)")
        print()
        print("Then run:  python agent.py")
        print("     or:   python agent.py --post   (to also post to Facebook)")
        sys.exit(0)

    should_post = "--post" in args
    config = load_config(config_path)
    cache = load_cache()

    markup = config.get("markup_percent", 80)
    searches = config.get("searches", [])
    radius = config.get("radius_miles", 100)
    max_bid = config.get("max_bid", 1500)
    max_daily_posts = config.get("max_daily_posts", 5)

    print("GovDeals Arbitrage Agent")
    print("=" * 60)
    print(f"Location       : {config.get('your_city_state')}  (ZIP {config.get('your_zip')})  within {radius} miles")
    print(f"Markup         : {markup}%  →  FB price = bid x {1 + markup/100:.2f}")
    print(f"Max bid        : ${max_bid}  (capital limit)")
    print(f"Max daily posts: {max_daily_posts}")
    print(f"Categories     : {len(searches)}")
    print(f"Cached items   : {len(cache.get('items', []))}")
    print(f"Mode           : {'SCAN + CONFIRM + POST' if should_post else 'SCAN ONLY  (add --post to also post to Facebook)'}")
    print("=" * 60)

    import datetime
    log_path = f"results_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
    print(f"Saving output to: {log_path}\n")

    # Phase 1: Always scan first
    with open(log_path, "w", encoding="utf-8") as log_file:
        scan_results = await stream_query(
            prompt=build_scan_prompt(config, cache),
            options=ClaudeAgentOptions(
                allowed_tools=["WebFetch", "WebSearch"],
                max_turns=15,
            ),
            log_file=log_file,
        )

    # Save found items to cache
    cache = save_to_cache(scan_results, cache)

    if not should_post:
        return

    # Phase 2: Ask which items to post
    print("\n" + "=" * 60)
    print("Which items do you want to post to Facebook Marketplace?")
    print("  all        → post every item above")
    print("  1,3,5      → post specific item numbers")
    print("  none       → don't post anything")
    print()
    choice = input("Your choice: ").strip().lower()

    if not choice or choice == "none":
        print("Nothing posted.")
        return

    if choice == "all":
        items_to_post = "Post ALL items marked ✅ WORTH LISTING in the scan results."
    else:
        items_to_post = f"Post only items numbered: {choice}"

    # Phase 3: Post selected items
    print()
    print("=" * 60)
    print(f"Posting: {items_to_post}")
    print("=" * 60)

    with open(log_path, "a", encoding="utf-8") as log_file:
        log_file.write("\n\n=== POST PHASE ===\n")
        await stream_query(
            prompt=build_post_prompt(config, scan_results, items_to_post),
            options=ClaudeAgentOptions(
                allowed_tools=["WebFetch", "WebSearch"],
                max_turns=20,
                mcp_servers={
                    "playwright": {
                        "command": "npx",
                        "args": ["@playwright/mcp@latest"],
                    }
                },
            ),
            log_file=log_file,
        )


if __name__ == "__main__":
    anyio.run(main)
