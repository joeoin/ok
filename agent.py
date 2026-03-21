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


DEFAULT_CONFIG = {
    "markup_percent": 80,
    "max_listings_per_search": 5,
    "your_city_state": "Phoenix, AZ",
    "your_zip": "85001",
    "radius_miles": 100,
    "state": "AZ",
    "max_bid": 1500,
    "max_daily_posts": 5,
    "searches": [
        {"keywords": "", "category": "Vehicles"},
        {"keywords": "", "category": "Power Sports & Recreational"},
        {"keywords": "", "category": "Trailers"},
        {"keywords": "", "category": "Construction & Farm Equipment"},
        {"keywords": "", "category": "Tools & Equipment"},
        {"keywords": "", "category": "Electronics & Computers"},
        {"keywords": "", "category": "Lawn & Garden"},
        {"keywords": "", "category": "Generators & Power Equipment"}
    ]
}


def load_config(config_path: str) -> dict:
    if os.path.exists(config_path):
        with open(config_path) as f:
            return json.load(f)
    return DEFAULT_CONFIG


def build_scan_prompt(config: dict) -> str:
    markup = config.get("markup_percent", 80)
    multiplier = 1 + markup / 100
    max_per = config.get("max_listings_per_search", 5)
    your_location = config.get("your_city_state", "Phoenix, AZ")
    your_zip = config.get("your_zip", "85001")
    radius = config.get("radius_miles", 100)
    state = config.get("state", "AZ")
    max_bid = config.get("max_bid", 1500)
    searches = config.get("searches", [])

    search_lines = ""
    for i, s in enumerate(searches, 1):
        cat = s.get("category", "All")
        kw = f'  keywords="{s["keywords"]}"' if s.get("keywords") else ""
        search_lines += f"  {i}. Category: {cat}{kw}\n"

    return f"""You are a government surplus arbitrage agent. Your job is to find
auction items near {your_location} across multiple auction sites and prepare Facebook
Marketplace listings to test buyer demand — before the user ever spends a dollar bidding.

════════════════════════════════════════
 PRICING RULES
   Step 1 — Calculate the minimum floor price:
     floor_price = current_bid x {multiplier:.2f}   (requires {markup}% profit minimum)
     If an item has zero bids, use the starting bid.

   Step 2 — Look up market / resale value for the item.

   Step 3 — Decide:
     SKIP  if market_value < floor_price  (can't clear {markup}% profit even at market rate)
     KEEP  if market_value >= floor_price

   Step 4 — Set the Facebook listing price:
     List at 90% of market value, rounded to nearest $5.
     This is NOT the bid x markup — it is based on what the item is actually worth.

   Example — Milwaukee drill set:
     Current bid = $80  ->  floor = $144
     Market value = $280  ->  FB listing price = $250  KEEP

 LOCATION FILTER
   State : {state}
   Radius: within {radius} miles of zip code {your_zip} ({your_location})
   Only include items the user can realistically drive to pick up.

 SKIP AN ITEM IF:
   • Current bid (or starting bid) exceeds ${max_bid} — capital limit
   • Market value is below the floor price (less than {markup}% profit possible)
   • The auction ends in less than 24 hours (not enough time to gauge FB interest)
   • The item requires shipping only (no local pickup available)
   • The item is too large to fit in a standard cargo van / U-Haul truck (e.g. full
     vehicles, heavy construction equipment, large trailers, riding mowers, boats).
     PREFER items that two people can load without special equipment: hand tools,
     power tools, electronics, generators (under 200 lbs), small appliances, office
     furniture, and similar man-portable or dolly-movable items.
   • Military surplus items (weapons, body armor, military vehicles, etc.)
════════════════════════════════════════

## STEP 1: Find Listings Using WebSearch

Search for auction listings using WebSearch. Do NOT try to directly fetch auction
site homepages — they block bots. Instead use targeted search queries.

HARD LIMITS — you must respect these:
  • Stop searching as soon as you have {max_per} candidate items — do not keep going
  • If a WebFetch fails or returns no useful data, skip that URL immediately (no retries)
  • If a search returns no auction listings, move on to the next search
  • Do not fetch category pages or homepages — individual item pages only
  • Complete all steps and print the final summary before you run out of turns

Run these searches and collect results:

  1. WebSearch: "site:govdeals.com {state} tools auction pickup {your_zip}"
  2. WebSearch: "site:publicsurplus.com {state} tools electronics auction"
  3. WebSearch: "site:hibid.com {state} surplus tools electronics auction"
  4. WebSearch: "site:auctionzip.com {state} government surplus tools"
  5. WebSearch: "site:bid4assets.com {state} surplus auction"
  6. WebSearch: "{your_location} government surplus auction tools electronics 2025 2026"
  7. WebSearch: "publicsurplus.com {state} {your_zip} auction ending"
  8. WebSearch: "hibid.com {your_location} surplus tools generators electronics"

Stop running searches the moment you reach {max_per} candidates — skip remaining searches.
For any promising result URLs, use WebFetch to get listing details (one attempt only, skip if it fails).

Collect up to {max_per} total candidate items across all sites. For each item record:
  • Full title
  • Lot or item number
  • Current bid (or starting bid if no bids yet)
  • Number of bids so far
  • Auction end date/time
  • Pickup city and state
  • Photo URLs if available
  • Item condition / notes
  • Direct listing URL
  • Which auction site it came from

────────────────────────────────────────────────────────────────
## STEP 2: Market Value Research

For each candidate item, run ONE WebSearch to find real resale prices:
  • "[item name] for sale site:facebook.com/marketplace" OR "craigslist" OR "ebay sold"
  • Use the most relevant comparable — same model, similar condition and year
  • One search per item only — use your best estimate if results are thin

Then decide:
  KEEP  — market value is ABOVE the floor price (bid x {multiplier:.2f})
  SKIP  — market value is AT or BELOW floor price (not enough margin)

Calculate the Facebook listing price for kept items:
  FB list price = market_value x 0.90, rounded to nearest $5

Only proceed to the listing format for KEPT items.
────────────────────────────────────────────────────────────────

## STEP 3: Format Each Kept Item

Number each item starting from 1. Print each item in this format:

================================================
ITEM #          : [number]
ITEM            : [full title]
LOT #           : [lot/item number]
AUCTION SITE    : [site name]
LISTING LINK    : [URL]
CURRENT BID     : $[amount]  ([# bids] bids)
AUCTION ENDS    : [date/time]
PICKUP LOCATION : [city, state]
EST. RESALE     : $[typical market value from your search]
FLOOR PRICE     : $[current_bid x {multiplier:.2f}]  <- minimum to clear {markup}% profit
FB LIST PRICE   : $[90% of market value, rounded to $5]
VERDICT         : WORTH LISTING  (potential profit = FB price - bid = $X)
PHOTOS          : [list all photo URLs if found]

-- Facebook Marketplace Listing --
Title       : [brand + item + key spec, max 100 chars]
Price       : $[FB price]
Category    : [FB Marketplace category]
Condition   : [Used - Good / Used - Fair / etc.]
Description :
  [Sentence 1: what it is and key specs (year, model, hours/miles if known).]
  [Sentence 2: condition summary from the listing.]
  [Sentence 3: why this is a deal -- mention government surplus if relevant.]
  Local pickup only -- {your_location}. Message me for more details and photos.
================================================

## Final Summary

Print one line per item:
  [KEEP/SKIP] #[n] Item name | Site: [auction site] | Bid: $X | Market: $Z | FB List: $Y | Profit: $P | Ends: [date]

Then print totals:
  "Scanned: X  |  Worth listing: Y  |  Skipped (low margin): Z"
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

    markup = config.get("markup_percent", 80)
    searches = config.get("searches", [])
    radius = config.get("radius_miles", 100)
    max_bid = config.get("max_bid", 1500)
    max_daily_posts = config.get("max_daily_posts", 5)

    print("GovDeals Arbitrage Agent")
    print("=" * 60)
    print(f"Location       : {config.get('your_city_state')}  (ZIP {config.get('your_zip')})  within {radius} miles")
    print(f"Markup         : {markup}%  →  FB price = bid × {1 + markup/100:.2f}")
    print(f"Max bid        : ${max_bid}  (capital limit)")
    print(f"Max daily posts: {max_daily_posts}")
    print(f"Categories     : {len(searches)}")
    print(f"Mode           : {'SCAN + CONFIRM + POST' if should_post else 'SCAN ONLY  (add --post to also post to Facebook)'}")
    print("=" * 60)

    import datetime
    log_path = f"results_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
    print(f"Saving output to: {log_path}\n")

    # Phase 1: Always scan first
    with open(log_path, "w", encoding="utf-8") as log_file:
        scan_results = await stream_query(
            prompt=build_scan_prompt(config),
            options=ClaudeAgentOptions(
                allowed_tools=["WebFetch", "WebSearch"],
                max_turns=40,
            ),
            log_file=log_file,
        )

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
