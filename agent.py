"""
GovDeals Arbitrage Agent

Finds government surplus auction items on GovDeals.com and lists them
on Facebook Marketplace at 80% markup to test demand before bidding.

Workflow:
    1. Searches GovDeals.com based on criteria in config.json
    2. For each item: Facebook price = current_bid x 1.80
    3. Prints formatted listings (and optionally posts to Facebook Marketplace)
    4. If people message you on Facebook -> go bid on GovDeals yourself

Requirements:
    pip install claude-agent-sdk anyio
    npx @playwright/mcp@latest   (only needed with --post)

Setup:
    1. Edit config.json with your search criteria and location
    2. If using --post, make sure you are logged into Facebook in the browser

Usage:
    python agent.py                          # Scan GovDeals, print listings
    python agent.py --post                   # Scan + post to Facebook Marketplace
    python agent.py --config my_config.json  # Use a different config file
"""

import anyio
import json
import os
import sys

from claude_agent_sdk import query, ClaudeAgentOptions, ResultMessage, SystemMessage


DEFAULT_CONFIG = {
    "markup_percent": 80,
    "max_listings_per_search": 5,
    "your_city_state": "Your City, ST",
    "searches": [
        {
            "keywords": "",
            "category": "Electronics",
            "state": "",
            "min_bid": 0,
            "max_bid": 500
        }
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
    max_listings = config.get("max_listings_per_search", 5)
    your_location = config.get("your_city_state", "your city")
    searches = config.get("searches", [])

    search_instructions = ""
    for i, s in enumerate(searches, 1):
        parts = []
        if s.get("keywords"):
            parts.append(f'keywords="{s["keywords"]}"')
        if s.get("category"):
            parts.append(f'category={s["category"]}')
        if s.get("state"):
            parts.append(f'state={s["state"]}')
        min_bid = s.get("min_bid", 0)
        max_bid = s.get("max_bid")
        if max_bid:
            parts.append(f'bid range=${min_bid}–${max_bid}')
        search_instructions += f"  Search {i}: {', '.join(parts)}\n"

    post_instructions = ""
    if should_post:
        post_instructions = """
## STEP 2: Post Each Item to Facebook Marketplace

For each item, navigate to https://www.facebook.com/marketplace/create/item and:

1. Title        -> paste the FB Marketplace title you prepared
2. Price        -> enter the FB price (numbers only, no $ sign)
3. Category     -> pick the closest Facebook Marketplace category
4. Condition    -> "Used - Good" unless item description says otherwise
5. Description  -> paste the FB description you prepared
6. Photos       -> download the first GovDeals photo and upload it
7. Click "Next" then "Publish"
8. Wait for the confirmation screen before moving to the next listing

STOP and notify the user if you are not logged into Facebook.
"""

    return f"""You are a government surplus arbitrage agent. Your goal is to find
auction items on GovDeals.com and prepare Facebook Marketplace listings so the
user can gauge demand before deciding whether to bid.

────────────────────────────────────────
PRICING RULE
  Facebook price = current_bid × {multiplier:.2f}   ({markup}% markup)
  Round to the nearest $5 for clean pricing.
  If there are zero bids, use the starting bid as the base.
────────────────────────────────────────

## STEP 1: Scrape GovDeals.com

Visit https://www.govdeals.com/en and run each of these searches:

{search_instructions}
For each search collect up to {max_listings} items. For every item extract:

  • Title           - full item name
  • Lot number      - GovDeals lot / item ID
  • Current bid     - highest bid so far (or starting bid if no bids yet)
  • Auction end     - date and time the auction closes
  • Pickup location - city and state where the item must be collected
  • Condition notes - any damage, mileage, hours, or condition info in the listing
  • Photo URL       - URL of the first/main photo
  • GovDeals URL    - direct link to the listing

Then calculate the Facebook price and format each item like this:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ITEM            : [full title]
LOT #           : [lot number]
GOVDEALS LINK   : [URL]
CURRENT BID     : $[amount]
FB PRICE        : $[calculated price]
AUCTION ENDS    : [date/time]
PICKUP LOCATION : [city, state]

FB MARKETPLACE LISTING
  Title       : [catchy title, max 100 characters]
  Price       : $[FB price]
  Category    : [Facebook Marketplace category]
  Description :
    [2-3 sentences: what it is, key specs/condition, why it is a good deal.
     End with: "Local pickup — {your_location}. Message me for details."]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{post_instructions}
After all items, print a one-line summary:
  "Found X items across Y searches. FB prices range from $A to $B."
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

    # First run: create default config and exit
    if not os.path.exists(config_path):
        with open(config_path, "w") as f:
            json.dump(DEFAULT_CONFIG, f, indent=2)
        print("Created config.json — edit it with your search criteria, then run again.")
        print("  your_city_state  : where you are located (for FB listings)")
        print("  searches         : list of GovDeals searches to run")
        print("  markup_percent   : how much to mark up (default 80)")
        print("  max_listings_per_search : max items per search (default 5)")
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

    print("GovDeals Arbitrage Agent")
    print("=" * 60)
    print(f"Config         : {config_path}")
    print(f"Markup         : {markup}%  (FB price = bid × {1 + markup/100:.2f})")
    print(f"Searches       : {len(searches)}")
    print(f"Your location  : {config.get('your_city_state', 'not set')}")
    print(f"Mode           : {'SCAN + POST to Facebook Marketplace' if should_post else 'SCAN ONLY (add --post to post to Facebook)'}")
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
