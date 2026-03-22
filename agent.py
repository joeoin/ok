"""
GovDeals Arbitrage Agent

Finds government surplus auction items near you, checks resale value,
and optionally posts them to Facebook Marketplace to test demand before bidding.

Workflow:
    1. Searches GovDeals.com and PublicSurplus for items near you
    2. Checks eBay sold listings for market value
    3. Filters out anything where the margin isn't worth it
    4. Prints the good deals with bid price, market value, and profit estimate
    5. (--post) Asks which items to post, then posts them to Facebook Marketplace

Requirements:
    pip install claude-agent-sdk anyio requests beautifulsoup4 playwright
    playwright install chromium --with-deps
    npx @playwright/mcp@latest   (only needed with --post)

Setup:
    1. Edit config.json — set your_city_state, your_zip, and state
    2. Run: python agent.py

Usage:
    python agent.py              # Scan and print deals
    python agent.py --post       # Scan, confirm each item, then post to Facebook
    python agent.py --config other.json  # Use a different config file
"""

import anyio
import json
import os
import sys

from claude_agent_sdk import query, ClaudeAgentOptions, ResultMessage, SystemMessage, AssistantMessage


CACHE_PATH = "found_items.json"

import platform as _platform
import shutil as _shutil
CLAUDE_PATH = _shutil.which("claude") or "claude"

# On Windows, anyio cannot spawn .cmd batch scripts directly (not PE executables).
# Find node.exe + cli.js and use those as the real executable instead.
_NODE_PATH = None
_CLI_JS_PATH = None
if _platform.system() == "Windows" and CLAUDE_PATH.lower().endswith(".cmd"):
    import os as _os
    _node = _shutil.which("node")
    _npm_dir = _os.path.expandvars(r"%APPDATA%\npm")
    _cli_js = _os.path.join(_npm_dir, "node_modules", "@anthropic-ai", "claude-code", "cli.js")
    if _node and _os.path.exists(_cli_js):
        _NODE_PATH = _node
        _CLI_JS_PATH = _cli_js
        # Monkey-patch the command builder to use node.exe + cli.js directly
        from claude_agent_sdk._internal.transport import subprocess_cli as _subcli
        _orig_build = _subcli.SubprocessCLITransport._build_command
        def _win_build_command(self):
            cmd = _orig_build(self)
            # Replace the .cmd path with node + cli.js
            if cmd and cmd[0].lower().endswith(".cmd"):
                return [_NODE_PATH, _CLI_JS_PATH] + cmd[1:]
            return cmd
        _subcli.SubprocessCLITransport._build_command = _win_build_command


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


def build_post_prompt(scan_results: str, items_to_post: str) -> str:
    return (
        "You are operating under the WAT framework (Workflows, Agents, Tools).\n"
        "Your task: post selected auction items to Facebook Marketplace.\n\n"
        "Read `workflows/post_facebook.md` and follow it step by step.\n"
        "Runtime config is in `config.json`.\n\n"
        f"ITEM SELECTION: {items_to_post}\n\n"
        "SCAN RESULTS (post ONLY the items matching the selection above):\n"
        f"{scan_results}\n"
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

    should_post = "--post" in args

    config = load_config(config_path)
    cache = load_cache()

    searches = config.get("searches", [])
    radius = config.get("radius_miles", 100)
    max_bid = config.get("max_bid", 1500)
    min_profit = config.get("min_profit", 100)
    max_daily_posts = config.get("max_daily_posts", 5)

    print("GovDeals Arbitrage Agent")
    print("=" * 60)
    print(f"Location    : {config.get('your_city_state')}  (ZIP {config.get('your_zip')})  within {radius} miles")
    print(f"Max bid     : ${max_bid}")
    print(f"Min profit  : ${min_profit}")
    print(f"Searches    : {len(searches)}")
    print(f"Cached items: {len(cache.get('items', []))}")
    print(f"Mode        : {'SCAN + POST' if should_post else 'SCAN ONLY  (add --post to also post to Facebook)'}")
    print("=" * 60)

    import datetime
    log_path = f"results_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
    print(f"Saving output to: {log_path}\n")

    # Phase 1: Scan for deals
    with open(log_path, "w", encoding="utf-8") as log_file:
        scan_results = await stream_query(
            prompt=build_scan_prompt(),
            options=ClaudeAgentOptions(
                allowed_tools=["Bash", "Read"],
                max_turns=25,
                model="claude-haiku-4-5",
                cli_path=CLAUDE_PATH,
                stderr=lambda line: print(f"[claude] {line}", file=sys.stderr, flush=True),
                system_prompt=(
                    "You are an agent operating under the WAT framework (Workflows, Agents, Tools). "
                    "Your ONLY job is to execute the workflow in workflows/scan_govdeals.md exactly as written. "
                    "\n\n"
                    "TOOL USAGE — ABSOLUTE RULES:\n"
                    "- Run tool scripts in tools/ via bash for ALL searching, fetching, and price lookups.\n"
                    "- NEVER use WebSearch, WebFetch, or any direct internet access. These are forbidden.\n"
                    "- NEVER use your own knowledge to estimate prices, values, or market data.\n"
                    "- If a tool script returns an error or median_price=0, discard that item and move on. Do NOT substitute a guess.\n"
                    "\n"
                    "WORKFLOW RULES:\n"
                    "- Follow every step in the workflow in order. Do not skip steps. Do not add steps.\n"
                    "- Stop completely after Step 5. Do not do any further research, commentary, or analysis.\n"
                    "- Do not call any tool script more than once per item.\n"
                    "\n"
                    "DEDUPLICATION — CRITICAL:\n"
                    "- In the Setup step, read found_items.json and collect every URL listed.\n"
                    "- Any URL already in found_items.json must be silently skipped — never shown in output.\n"
                    "- This is non-negotiable. Repeat items are useless to the user.\n"
                    "\n"
                    "OUTPUT RULES:\n"
                    "- Output only what the workflow specifies: one text block per kept item, then the JSON block.\n"
                    "- Do not add summaries, commentary, action priorities, market analysis, or extra sections.\n"
                    "- The JSON block is required even if zero items passed all filters.\n"
                ),
            ),
            log_file=log_file,
        )

    save_to_cache(scan_results, cache)

    if not should_post:
        return

    # Phase 2: Ask which items to post
    print("\n" + "=" * 60)
    print("Which items do you want to post to Facebook Marketplace?")
    print("  all     → post every item from the scan above")
    print("  1,3,5   → post specific item numbers")
    print("  none    → don't post anything")
    print()
    choice = input("Your choice: ").strip().lower()

    if not choice or choice == "none":
        print("Nothing posted.")
        return

    if choice == "all":
        items_to_post = "Post ALL items listed in the scan results."
    else:
        items_to_post = f"Post only items numbered: {choice}"

    # Phase 3: Post to Facebook Marketplace
    print()
    print("=" * 60)
    print(f"Posting: {items_to_post}")
    print(f"Make sure you are logged into Facebook in the browser.")
    print("=" * 60)
    print()

    await stream_query(
        prompt=build_post_prompt(scan_results, items_to_post),
        options=ClaudeAgentOptions(
            allowed_tools=["Bash", "Read"],
            max_turns=max_daily_posts * 15,
            model="claude-haiku-4-5",
            cli_path=CLAUDE_PATH,
            stderr=lambda line: print(f"[claude] {line}", file=sys.stderr, flush=True),
            mcp_servers={
                "playwright": {
                    "command": "npx",
                    "args": ["@playwright/mcp@latest"],
                }
            },
            system_prompt=(
                "You are an agent operating under the WAT framework (Workflows, Agents, Tools). "
                "Your ONLY job is to execute the workflow in workflows/post_facebook.md exactly as written. "
                "Follow every step in order. Do not skip steps or add extra actions. "
                "Use the Playwright browser tools for all Facebook interactions. "
                "Use Bash only to download photos to temp files before uploading them."
            ),
        ),
    )


if __name__ == "__main__":
    anyio.run(main)
