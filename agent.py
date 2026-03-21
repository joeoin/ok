"""
GovDeals Arbitrage Agent

Finds government surplus auction items on GovDeals.com within your area
and lists them on Facebook Marketplace at 80% markup to test demand before bidding.

Workflow:
    1. Searches GovDeals.com for items near you based on config.json
    2. Checks approximate market value — skips items where 80% markup
       would price them above what they actually sell for
    3. Prints formatted FB Marketplace listings (using GovDeals photos)
    4. Optionally posts them to Facebook Marketplace via browser automation
    5. If people message you on Facebook -> go bid on GovDeals yourself

Requirements:
    pip install claude-agent-sdk anyio
    npx @playwright/mcp@latest   (only needed with --post)

Setup:
    1. Edit config.json — set your_city_state and your zip code
    2. If using --post, make sure you are logged into Facebook in the browser

Usage:
    python agent.py              # Scan GovDeals, print listings
    python agent.py --post       # Scan + post to Facebook Marketplace
"""

import anyio
import json
import os
import sys

from claude_agent_sdk import query, ClaudeAgentOptions, ResultMessage, SystemMessage


DEFAULT_CONFIG = {
    "markup_percent": 80,
    "max_listings_per_search": 5,
    "your_city_state": "Phoenix, AZ",
    "your_zip": "85001",
    "radius_miles": 100,
    "state": "AZ",
    "max_bid": 1500,
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


def build_prompt(config: dict, should_post: bool) -> str:
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

    post_instructions = ""
    if should_post:
        post_instructions = f"""
## STEP 3: Post Each Approved Item to Facebook Marketplace

For EACH item that passed the value check, post it to Facebook Marketplace:

1. Navigate to https://www.facebook.com/marketplace/create/item
2. **Photos**: Download each GovDeals photo URL to a temp file, then upload all of them.
   Use every photo available from the listing — more photos = more buyer trust.
3. **Title**: Use the FB title you prepared (max 100 chars)
4. **Price**: FB price as a plain number (no $ sign)
5. **Category**: Closest Facebook Marketplace category
6. **Condition**: "Used - Good" unless listing clearly says otherwise
7. **Description**: Use the FB description you prepared
8. **Location**: {your_location}
9. Click "Next" then "Publish"
10. Wait for the success confirmation before starting the next listing

STOP immediately and notify the user if you are not logged into Facebook.
After all postings, print how many were successfully posted.
"""

    return f"""You are a government surplus arbitrage agent. Your job is to find
auction items on GovDeals.com near {your_location} and list them on Facebook
Marketplace to test buyer demand — before the user ever spends a dollar bidding.

════════════════════════════════════════
 PRICING RULES
   Step 1 — Calculate the minimum floor price:
     floor_price = current_bid × {multiplier:.2f}   (requires {markup}% profit minimum)
     If an item has zero bids, use the starting bid.

   Step 2 — Look up market / resale value for the item.

   Step 3 — Decide:
     SKIP  if market_value < floor_price  (can't clear {markup}% profit even at market rate)
     KEEP  if market_value >= floor_price

   Step 4 — Set the Facebook listing price:
     List at 90% of market value, rounded to nearest $5.
     (Slightly below market = competitive price that attracts buyers fast)
     This is NOT the bid × markup — it is based on what the item is actually worth.

   Example — John Deere Gator 4x2:
     Current bid = $500  →  floor = $900
     Market value ≈ $3,500  →  FB listing price = $3,150  ✅ KEEP

 LOCATION FILTER
   State : {state}
   Radius: within {radius} miles of zip code {your_zip} ({your_location})
   Only include items the user can realistically drive to pick up.

 SKIP AN ITEM IF:
   • Current bid (or starting bid) exceeds ${max_bid} — capital limit
   • Market value is below the floor price (less than {markup}% profit possible)
   • The auction ends in less than 24 hours (not enough time to gauge FB interest)
   • The item requires shipping only (no local pickup available)
════════════════════════════════════════

## STEP 1: Scrape GovDeals.com

Visit https://www.govdeals.com/en and search for items in {state} (radius {radius} miles
from {your_zip}) across these categories:

{search_lines}
Collect up to {max_per} candidate items per category. For each item record:
  • Full title
  • Lot number
  • Current bid (or starting bid if no bids yet)
  • Number of bids so far
  • Auction end date/time
  • Pickup city and state
  • ALL photo URLs from the listing
  • Item condition / notes (mileage, hours, damage, etc.)
  • Direct GovDeals listing URL

────────────────────────────────────────────────────────────────
## STEP 2: Market Value Research

For each candidate item, run a WebSearch to find real resale prices:
  • "{{item name}} for sale" Facebook Marketplace, Craigslist, eBay sold listings
  • Use the most relevant comparable — same model, similar condition and year

Then decide:
  ✅ KEEP   — market value is ABOVE the floor price (bid × {multiplier:.2f})
  ❌ SKIP   — market value is AT or BELOW floor price (not enough margin)

Calculate the Facebook listing price for kept items:
  FB list price = market_value × 0.90, rounded to nearest $5
  Goal: price it just under market so it looks like a deal and attracts serious buyers fast.

Example: John Deere Gator 4x2
  Current bid $500  →  floor = $900
  Market value ≈ $3,500  →  FB list price = $3,150  ✅ KEEP
  Potential profit if you win at current bid: $3,150 − $500 = $2,650

Only proceed to the listing format for KEPT items.
────────────────────────────────────────────────────────────────

## STEP 3: Format Each Kept Item

Print each item in this format:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ITEM            : [full title]
LOT #           : [lot number]
GOVDEALS LINK   : [URL]
CURRENT BID     : $[amount]  ([# bids] bids)
AUCTION ENDS    : [date/time]
PICKUP LOCATION : [city, state]
EST. RESALE     : $[typical market value from your search]
FLOOR PRICE     : $[current_bid × {multiplier:.2f}]  ← minimum to clear {markup}% profit
FB LIST PRICE   : $[90% of market value, rounded to $5]
VERDICT         : ✅ WORTH LISTING  (potential profit = FB price − bid = $X)
PHOTOS          : [list all photo URLs]

── Facebook Marketplace Listing ──
Title       : [brand + item + key spec, max 100 chars]
Price       : $[FB price]
Category    : [FB Marketplace category]
Condition   : [Used - Good / Used - Fair / etc.]
Description :
  [Sentence 1: what it is and key specs (year, model, hours/miles if known).]
  [Sentence 2: condition summary from the listing.]
  [Sentence 3: why this is a deal — mention government surplus if relevant.]
  Local pickup only — {your_location}. Message me for more details and photos.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{post_instructions}
## Final Summary

Print one line per item:
  [✅/❌] Item name | Bid: $X | Market: $Z | FB List: $Y | Profit: $P | Ends: [date]

Then print totals:
  "Scanned: X  |  Worth listing: Y  |  Skipped (low margin): Z"
"""


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

    mcp_servers = {}
    if should_post:
        mcp_servers["playwright"] = {
            "command": "npx",
            "args": ["@playwright/mcp@latest"],
        }

    markup = config.get("markup_percent", 80)
    searches = config.get("searches", [])
    radius = config.get("radius_miles", 100)
    max_bid = config.get("max_bid", 1500)

    print("GovDeals Arbitrage Agent")
    print("=" * 60)
    print(f"Location       : {config.get('your_city_state')}  (ZIP {config.get('your_zip')})  within {radius} miles")
    print(f"Markup         : {markup}%  →  FB price = bid × {1 + markup/100:.2f}")
    print(f"Max bid        : ${max_bid}  (capital limit)")
    print(f"Categories     : {len(searches)}")
    print(f"Mode           : {'SCAN + POST to Facebook Marketplace' if should_post else 'SCAN ONLY  (add --post to also post to Facebook)'}")
    print("=" * 60)

    async for message in query(
        prompt=build_prompt(config, should_post),
        options=ClaudeAgentOptions(
            allowed_tools=["WebFetch", "WebSearch"],
            mcp_servers=mcp_servers,
        ),
    ):
        if isinstance(message, ResultMessage):
            print(message.result)
        elif isinstance(message, SystemMessage) and message.subtype == "init":
            session_id = message.data.get("session_id", "")
            if session_id:
                print(f"Session: {session_id}\n")


if __name__ == "__main__":
    anyio.run(main)
