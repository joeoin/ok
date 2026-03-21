"""
GovDeals Deal Scanner

Finds government surplus auction items on GovDeals.com within your area
and shows you the ones worth bidding on based on resale value.

Workflow:
    1. Searches GovDeals.com and PublicSurplus for items near you
    2. Checks approximate market value on eBay sold listings
    3. Filters out anything where the margin isn't worth it
    4. Prints the good deals with bid price, market value, and profit estimate

Requirements:
    pip install claude-agent-sdk anyio requests beautifulsoup4

Setup:
    1. Edit config.json — set your_city_state, your_zip, and state
    2. Run: python agent.py

Usage:
    python agent.py              # Scan and print deals
    python agent.py --config other.json  # Use a different config file
"""

import anyio
import json
import os
import sys

from claude_agent_sdk import query, ClaudeAgentOptions, ResultMessage, SystemMessage, AssistantMessage


CACHE_PATH = "found_items.json"

DEFAULT_CONFIG = {
    "max_listings_per_search": 3,
    "your_city_state": "Phoenix, AZ",
    "your_zip": "85001",
    "radius_miles": 100,
    "state": "AZ",
    "max_bid": 1500,
    "min_profit": 100,
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


def build_scan_prompt() -> str:
    return (
        "You are operating under the WAT framework (Workflows, Agents, Tools).\n"
        "Your task: scan government surplus auction sites for profitable resale opportunities.\n\n"
        "Read `workflows/scan_govdeals.md` and follow it step by step.\n"
        "All runtime parameters are in `config.json`. Already-found items are in `found_items.json`.\n\n"
        "Use the tool scripts in `tools/` for all searching, fetching, and price lookups.\n"
        "Do not use WebSearch or WebFetch directly — those are handled by the tool scripts.\n"
    )


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
        print("  state            — two-letter state code (e.g. 'AZ')")
        print("  radius_miles     — pickup radius        (default 100)")
        print()
        print("Then run:  python agent.py")
        sys.exit(0)

    config = load_config(config_path)
    cache = load_cache()

    searches = config.get("searches", [])
    radius = config.get("radius_miles", 100)
    max_bid = config.get("max_bid", 1500)
    min_profit = config.get("min_profit", 100)

    print("GovDeals Deal Scanner")
    print("=" * 60)
    print(f"Location    : {config.get('your_city_state')}  (ZIP {config.get('your_zip')})  within {radius} miles")
    print(f"Max bid     : ${max_bid}")
    print(f"Min profit  : ${min_profit}")
    print(f"Searches    : {len(searches)}")
    print(f"Cached items: {len(cache.get('items', []))}")
    print("=" * 60)

    import datetime
    log_path = f"results_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
    print(f"Saving output to: {log_path}\n")

    with open(log_path, "w", encoding="utf-8") as log_file:
        scan_results = await stream_query(
            prompt=build_scan_prompt(),
            options=ClaudeAgentOptions(
                allowed_tools=["Bash", "Read"],
                max_turns=25,
                system_prompt=(
                    "You are an agent operating under the WAT framework (Workflows, Agents, Tools). "
                    "Workflows in workflows/ are your SOPs — read and follow them exactly. "
                    "Tools in tools/ are Python scripts — run them via bash for all deterministic work. "
                    "Never search or fetch web pages directly; use the tool scripts instead. "
                    "Execute steps in the workflow in order. Do not skip steps. Do not add extra steps. "
                    "If a tool script fails, log the error and continue to the next item."
                ),
            ),
            log_file=log_file,
        )

    save_to_cache(scan_results, cache)


if __name__ == "__main__":
    anyio.run(main)
