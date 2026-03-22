# Workflow: Post Items to Facebook Marketplace

## Objective
Post selected auction items to Facebook Marketplace to test buyer demand
before spending any money bidding.

The scan results and item selection are provided directly in the prompt.

---

## Setup — Read config

Run: `cat config.json`

Extract:
- `your_city_state` — used as the listing location
- `max_daily_posts` — hard stop after this many posts

---

## Step 1 — Verify Facebook login

Navigate to: `https://www.facebook.com/marketplace`

Check the page:
- If you see a login prompt or are redirected to `facebook.com/login`: **STOP**.
  Print: `ERROR: Not logged into Facebook. Please log in at facebook.com, then run agent.py --post again.`
  Exit immediately.
- If Marketplace loads normally: continue.

---

## Step 2 — Post each selected item

Work through items in the order given. Stop after `max_daily_posts` total successful posts.

For **each** item:

### 2a — Open the listing form

Navigate to: `https://www.facebook.com/marketplace/create/item`

Wait for the form to fully load before proceeding.

### 2b — Upload photos

For each URL in the item's PHOTOS list:
1. Download the image to a temporary file: `python -c "import urllib.request; urllib.request.urlretrieve('<url>', '/tmp/fb_photo_<n>.jpg')"`
2. Click the photo upload area and attach the temp file.

Upload every available photo. More photos dramatically improve response rate.
If a photo download or upload fails, skip that photo and continue — don't abort the whole listing.

### 2c — Fill in listing details

| Field       | Value                                           |
|-------------|------------------------------------------------|
| Title       | FB title from the listing (max 100 chars)       |
| Price       | FB list price — digits only, no `$` sign        |
| Category    | Closest Facebook Marketplace category           |
| Condition   | `Used - Good` unless the listing says otherwise |
| Description | FB description from the listing, word for word  |

### 2d — Set location

Set the listing location to the `your_city_state` value from config.json.
If Facebook auto-fills a different location, clear it and type the correct one.

### 2e — Submit

Click **Next**, then **Publish**.
Wait for the success confirmation before starting the next item.

On success: print `✅ Posted #[n]: [title]`
On failure: print `❌ Failed #[n]: [title] — [reason]` and continue to next item.

---

## Step 3 — Final report

After all items are processed (or `max_daily_posts` reached), print:

```
Posted X / Y items successfully.
Failed: Z
```

List any failures with their titles and reasons.

---

## Error handling

| Situation                        | Action                                                    |
|----------------------------------|-----------------------------------------------------------|
| Not logged in to Facebook        | STOP immediately, print login error (see Step 1)          |
| Photo download fails             | Skip that photo, continue with rest                       |
| Form submit error                | Print failure message, continue to next item              |
| Facebook shows CAPTCHA           | STOP and print: "Facebook CAPTCHA detected — try again later" |
| Rate limit / "too many posts"    | STOP and print: "Facebook rate limit hit — try again tomorrow" |
| `max_daily_posts` reached        | STOP and print final report                               |
