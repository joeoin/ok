#!/usr/bin/env python3
"""Preflight check — run this before the agent to confirm everything is ready.

Usage:
    python tools/check.py

Exits 0 if all checks pass, 1 if anything critical is broken.
"""

import sys
import subprocess

PASS = "OK  "
FAIL = "FAIL"
WARN = "WARN"

issues = []


def check(label: str, fn):
    try:
        msg = fn()
        print(f"  [{PASS}] {label}" + (f" — {msg}" if msg else ""))
        return True
    except Exception as e:
        print(f"  [{FAIL}] {label} — {e}")
        issues.append((label, str(e)))
        return False


print("\nPreflight check\n" + "=" * 40)

# --- Python packages ---
print("\nPackages:")
check("requests",       lambda: __import__("requests").__version__)
check("beautifulsoup4", lambda: __import__("bs4").__version__)

def _pw_version():
    import importlib.metadata
    return importlib.metadata.version("playwright")

has_playwright = check("playwright", _pw_version)

# --- Playwright browser ---
print("\nBrowser:")
if has_playwright:
    def _browser_check():
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            b = pw.chromium.launch(headless=True)
            ver = b.version
            b.close()
        return f"Chromium {ver}"
    browser_ok = check("Chromium launches", _browser_check)
else:
    print(f"  [SKIP] Chromium (playwright not installed)")
    browser_ok = False

# --- Network / sites ---
print("\nNetwork:")
import socket

def _net(host: str):
    socket.setdefaulttimeout(5)
    socket.socket(socket.AF_INET, socket.SOCK_STREAM).connect((host, 443))
    return "reachable"

check("govdeals.com",      lambda: _net("www.govdeals.com"))
check("publicsurplus.com", lambda: _net("www.publicsurplus.com"))
check("ebay.com",          lambda: _net("www.ebay.com"))

# --- Tool scripts (syntax only) ---
print("\nTools:")

def _syntax(path: str):
    r = subprocess.run(
        [sys.executable, "-m", "py_compile", path],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip())
    return "syntax OK"

check("tools/search_auctions.py",   lambda: _syntax("tools/search_auctions.py"))
check("tools/fetch_listing.py",     lambda: _syntax("tools/fetch_listing.py"))
check("tools/check_market_value.py",lambda: _syntax("tools/check_market_value.py"))

# --- Config ---
print("\nConfig:")

def _config():
    import json
    with open("config.json") as f:
        cfg = json.load(f)
    required = ["state", "searches"]
    missing = [k for k in required if not cfg.get(k)]
    if missing:
        raise RuntimeError(f"missing keys: {missing}")
    return f"state={cfg['state']}, {len(cfg['searches'])} search(es)"

check("config.json", _config)

# --- Summary ---
print("\n" + "=" * 40)
if not issues:
    print("All checks passed — ready to run the agent.\n")
    sys.exit(0)
else:
    print(f"{len(issues)} issue(s) found — fix before running the agent:\n")
    fixes = {
        "requests":        "pip install requests",
        "beautifulsoup4":  "pip install beautifulsoup4",
        "playwright":      "pip install playwright==1.56.0",
        "Chromium launches": "playwright install chromium",
        "govdeals.com":    "Check your internet connection",
        "publicsurplus.com": "Check your internet connection",
        "ebay.com":        "Check your internet connection",
        "config.json":     "Edit config.json and fill in required fields",
    }
    for label, _ in issues:
        fix = fixes.get(label, "See error above")
        print(f"  {label}: {fix}")
    print()
    sys.exit(1)
