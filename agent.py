"""
Deal Scraper + Facebook Marketplace Poster Agent

This agent:
1. Scrapes a website for deals/discounts
2. Formats them as Facebook Marketplace listings
3. Uses Playwright browser automation to post them on Facebook Marketplace

Requirements:
- pip install claude-agent-sdk anyio
- npx @playwright/mcp@latest  (for browser automation)
- You must be logged into Facebook in the Playwright browser session

Usage:
    python agent.py <website_url> [--post]

    --post   Actually open Facebook Marketplace and post the listings
             (omit to just print formatted listings without posting)
"""

import anyio
import sys
from claude_agent_sdk import query, ClaudeAgentOptions, ResultMessage, SystemMessage


def build_prompt(url: str, should_post: bool) -> str:
    post_instructions = ""
    if should_post:
        post_instructions = """
After collecting all deals, post each one to Facebook Marketplace:
1. Navigate to https://www.facebook.com/marketplace/create/item
2. Fill in the Title field with the listing title
3. Fill in the Price field with the price (numbers only)
4. Select the appropriate Category
5. Fill in the Description with the full listing description
6. Click "Next" and then "Publish"
7. Wait for confirmation before moving to the next listing

Important: If you are not logged into Facebook, stop and tell the user to log in first.
"""

    return f"""You are a deal-finding and listing agent. Your job is to:

1. Visit {url} and find all current deals, discounts, sales, or special offers.

2. For each deal found, extract:
   - Product name / title
   - Original price (if shown)
   - Sale price / deal price
   - Discount percentage (if shown)
   - Short description of the item
   - Product URL or link

3. Format each deal as a Facebook Marketplace listing with:
   - Title: Short, catchy (max 100 chars) — include brand, item, and condition
   - Price: The sale/deal price as a number
   - Description: 2-3 sentences covering what it is, why it's a deal, and key features
   - Category suggestion (Electronics, Home & Garden, Clothing, etc.)

4. Print a summary of all deals found before posting.
{post_instructions}
Start by fetching the website and identifying all deals."""


async def main() -> None:
    args = sys.argv[1:]

    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        sys.exit(0)

    url = args[0]
    should_post = "--post" in args

    # Build the MCP servers config — Playwright is only needed when posting
    mcp_servers = {}
    if should_post:
        mcp_servers["playwright"] = {
            "command": "npx",
            "args": ["@playwright/mcp@latest"],
        }

    allowed_tools = ["WebFetch", "WebSearch"]
    if should_post:
        # Playwright tools are exposed via MCP — no need to add them to allowed_tools
        pass

    print(f"Scanning {url} for deals...")
    if should_post:
        print("Will post listings to Facebook Marketplace (make sure you're logged in).")
    print("-" * 60)

    async for message in query(
        prompt=build_prompt(url, should_post),
        options=ClaudeAgentOptions(
            allowed_tools=allowed_tools,
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
