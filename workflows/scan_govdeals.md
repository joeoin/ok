# Workflow: Scan Government Surplus Auctions

## Objective
Find government surplus auction items near the user's location with profitable resale
potential on Facebook Marketplace.

## Setup — Read config before starting

Run: `cat config.json`

Extract these values:
- `state` — two-letter state code
- `your_zip` — ZIP code for proximity filtering
- `your_city_state` — city and state for FB listing location line
- `radius_miles` — max pickup distance
- `max_bid` — skip items at or above this bid
- `markup_percent` — multiplier = 1 + markup_percent / 100
- `max_listings_per_search` — max URLs to evaluate per search entry
- `searches` — list of `{category, keywords}` pairs

Also run: `cat found_items.json 2>/dev/null || echo '{"items":[]}'`

Collect all `.url` values from `found_items.json` — these are already-found items to skip.

---

## Step 1 — Search auction sites

For **each entry** in `searches`, run **exactly one** command:

```
python tools/search_auctions.py --state <state> --category "<category>" [--keywords "<keywords>"] --max <max_listings_per_search>
```

Collect all returned URLs across all search entries.
Do **not** run extra searches. One command per search entry, nothing more.

---

## Step 2 — Fetch each listing

Remove any URL that is already in the skip list from Step Setup.

For each remaining URL, run **exactly one** command:

```
python tools/fetch_listing.py --url "<url>"
```

If the script exits non-zero or the JSON contains `"error"`, skip that URL and continue.
Do **not** retry a failed URL.

---

## Step 3 — Filter listings

Discard any item where **any** of the following is true:

- Pickup location is more than `radius_miles` from `your_zip`
- `current_bid` is 0 (could not parse bid — skip)
- `current_bid` ≥ `max_bid`
- Item is a vehicle, trailer, real estate, or equipment weighing more than 200 lbs
- Auction ends in less than 24 hours (or `end_date` is empty — skip)

---

## Step 4 — Check market value

For each item that passed Step 3, run **exactly one** command:

```
python tools/check_market_value.py --item "<title>"
```

Compute:
- `market_value` = `median_price` from the tool output (use 0 if tool failed)
- `fb_price` = `round(market_value * 0.90 / 5) * 5`
- Discard if `fb_price < current_bid * multiplier`
- Discard if `market_value` is 0 (no data)

---

## Step 5 — Output results

Print each kept item in the format below.
Then emit the JSON block.
**Stop here — no further tool calls after this step.**

### Text format (one block per item):

```
ITEM: [title] | LOT: [lot#] | SITE: [site] | URL: [url]
BID: $X | MARKET: $Y | FB PRICE: $Z | PROFIT: $P | ENDS: [date]
PICKUP: [city, state] | PHOTOS: [photo url 1] [photo url 2] ...
FB TITLE: [max 100 chars, plain and descriptive]
FB DESCRIPTION: [3 sentences describing condition and features. End with "Local pickup only — <your_city_state>."]
```

### JSON block (required even if items list is empty):

```json
{
  "items": [
    {
      "title": "",
      "lot": "",
      "site": "",
      "url": "",
      "bid": 0,
      "market_value": 0,
      "fb_price": 0,
      "pickup": "City, ST",
      "ends": "YYYY-MM-DD",
      "photos": [],
      "fb_title": "",
      "fb_description": "",
      "fb_category": "Tools & Equipment",
      "fb_condition": "Used - Good"
    }
  ]
}
```

---

## Error handling

- Tool script fails (non-zero exit): note the error, skip that item, continue
- `found_items.json` missing: treat skip list as empty
- Market value ambiguous or 0: discard the item (conservative)
- Rate limiting: `fetch_listing.py` handles backoff internally — do not retry manually
- If a search returns 0 results: continue to the next search entry

## What to update in this workflow

When you discover new things (rate limits, URL patterns, filter quirks), note them here
in a `## Learnings` section at the bottom. Do not modify the Steps section without
asking the user first.
