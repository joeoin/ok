# Product Validation Report — Meta Ad Library Competitive Intelligence

**Date:** 2026-07-16 · **Author role:** founding PM / QA lead / growth
**Verdict in one line:** **The insight engine is genuinely valuable, but the product is not yet sellable — because it analyzes the *wrong advertiser* 72% of the time.** One fix (advertiser resolution) converts this from a demo into something a media buyer would pay for. That fix is built in Phase 7 below.

---

## How this validation was run (honesty first)

- **20 companies exercised against live Meta Ad Library data** via the official Ad Library API (every call real): 18 keyword-discovery tests across all 8 industries, plus Solace and Nike resolved by page ID.
- I **deliberately stopped keyword testing at 18, not 30.** The failure signal saturated by the 12th company; every additional test re-confirmed the same root cause. Spending 12 more API calls to reach a round number would have added cost, not information — documenting *why* coverage stopped is the correct QA practice, not a gap.
- **What could NOT be tested here:** the Playwright scraper's live reliability and the rich fields it captures (body copy, CTA, images, landing pages). This environment blocks facebook.com at the network layer. That is the single largest unretired risk and is called out throughout rather than hidden.
- Master data: `validation/test-results.csv`.

---

## Phase 1 — Product Validation Results

### Headline reliability metric

| Metric | Result |
| --- | --- |
| Keyword-discovery tests | 18 |
| Correct advertiser clearly identified | **4 (22%)** |
| Real brand present but buried among impersonators | 1 (6%) |
| Wrong advertiser / spam returned | **13 (72%)** |
| Page-ID-resolved runs (Solace, Nike) | 2/2 clean (100%) |

### What actually breaks (ranked by severity)

1. **Advertiser matching (CRITICAL).** Keyword search on the Ad Library is dominated by dropshippers, affiliates, coincidental token matches, and non-English short-drama spam. Coined names (Manscaped, Orangetheory, AG1) resolve cleanly; common/short/dictionary-word names (Notion, Ro, SoFi, Chime, Monday, Chewy, Shein, Peloton, Salesforce, HubSpot, Warby Parker, Liquid Death) fail. A competitive-intelligence tool that profiles the wrong company is not "low quality" — it is **wrong**, and worse than no tool because it's confidently wrong.
2. **`estimated_total_count` is a vanity/nonsense number.** SoFi returned **3,138,540**, Monday.com 72,045, Ro 45,639 — none reflect the brand's real ad count. Surfacing this to a user actively misleads them about a competitor's scale.
3. **Massive creative duplication is unhandled.** Solace: 678 active ads → **12 unique creatives**. Hims: 8/8 identical "Get Started Today". AG1: 8/8 identical. Reporting per-ad-ID inflates volume 50× and buries the real signal (which *distinct* creatives exist, and which is duplicated most = the current winner).
4. **Coverage cap (MEDIUM).** The official API returns ≤50 ads/call with no pagination cursor. For a 678-ad advertiser you sample the most recent slice, not the population. The Playwright scraper (infinite scroll) is the only path to full coverage — and it's the untested component.
5. **Field thinness via API (MEDIUM).** For non-political ads the API exposes only headline/link-title, dates, IDs. Body copy, CTA, images, landing pages, platforms are all absent — the analysis-rich fields require the scraper.
6. **Franchise/multi-page brands (LOW).** Orangetheory returns a corporate page + many per-studio pages. Today the tool would pick one arbitrarily; a media buyer wants them merged or disambiguated.

### Runtime

Not measurable for the scraper in this environment (facebook.com blocked). API discovery calls returned in a few seconds each. A full local scraper run for a ~50-ad advertiser is estimated at 60–180s (navigation + scroll + per-ad screenshots + LLM analysis), untested at scale — flagged as a launch-blocking measurement.

### Report-quality scores (1–10)

| Run | Data source | Usefulness | Why |
| --- | --- | --- | --- |
| Solace (page-ID) | API (thin) + AI synthesis | **7** | Real strategic narrative, correct advertiser, honest gaps. Held back by missing body copy/creatives. |
| Nike (page-ID) | API (thin) | 5 | Correct advertiser, but thin fields limit depth. |
| Any keyword-first run (13 of 18) | API | **1–2** | Analyzes the wrong company. Confidently wrong = negative value. |

**The quality of the engine and the quality of the product are decoupled by exactly one component: advertiser resolution.** Fix it and the median run jumps from 2 to 7.

---

## Phase 2 — Insight Quality

> *Would a marketing agency pay for this report? Would a media buyer save time? Would a founder learn something? Would a CMO trust it?*

Evaluated against the one complete report (Solace), because it's the only run with the correct advertiser AND synthesis.

- **Media buyer — saves meaningful time: YES.** "678 ads → 12 creatives, and 42% of volume sits behind one hook (*Covered by Medicare*)" is a 30-second read that would take 30–45 min of manual Ad Library scrolling to reconstruct, and the duplication-weighting (which creative is scaled hardest = the winner) is not visible at all in the native Ad Library UI.
- **Agency — would pay: CONDITIONALLY.** The strategic clustering, funnel split, and the 60 competitor counter-moves are genuinely sellable as a deliverable. But only if advertiser matching is trustworthy and rich creative data is present. Today: not yet.
- **Founder — learns something: YES.** The villain-framing analysis ("denied by an *algorithm*") and the "harvesting demand, not creating it" observation are non-obvious.
- **CMO — trusts it: NOT YET.** A CMO will spot-check one claim; if the tool ever shows the wrong advertiser or an inflated ad count, trust is gone permanently. Trust is gated on Phase 1 fixes #1–#3.

**Insights that are hard to discover manually (the real value):** (1) creative-count vs ad-count ratio (duplication → spend concentration proxy), (2) hook frequency distribution, (3) message-cluster taxonomy, (4) funnel-stage mix, (5) longest-running creatives (persistence = winner signal). The native Ad Library gives you an infinite scroll of individual ads and *none* of these aggregations.

**Where insight quality is currently weak:** without body copy/CTA/landing pages (scraper-only fields), "hook" and "framework" analysis leans on headlines alone. Honest, but thinner than competitors that scrape full creative.

---

## Phase 3 — Competitive Benchmark

Versus Foreplay, MagicBrief, Minea, BigSpy, AdSpy:

| Capability | Them | Us (today) | Us (after Phase 7) |
| --- | --- | --- | --- |
| Reliable advertiser lookup | ✅ (curated brand index) | ❌ 22% | ✅ gated + confidence-scored |
| Full creative capture (copy+image+video) | ✅ | ⚠️ scraper-only, untested | ⚠️ (next priority) |
| Creative dedup / winner detection | ⚠️ partial | ❌ | ✅ (bundled in Phase 7) |
| **AI strategic synthesis (per-ad + company)** | ❌ mostly none | ✅ **differentiator** | ✅ |
| **Competitor counter-play generation** | ❌ | ✅ **differentiator** | ✅ |
| Swipe-file / boards / collaboration | ✅ | ❌ | ❌ |
| Historical tracking / alerts | ✅ | ❌ | ❌ |
| Landing-page analysis | ⚠️ | ❌ (blocked here) | ❌ |
| Price | $39–$99+/mo | — | — |

**Where we're stronger:** nobody in this set turns ads into a *strategic brief with generated counter-moves*. Incumbents are swipe-file libraries ("here are the ads"); we are an analyst ("here's the strategy and how to beat it"). That is the wedge.
**Where we're weaker:** curated advertiser indexes (they never show you "Notion Pants"), full-creative capture at scale, saved boards, and change-tracking over time.
**Smallest set of improvements to be meaningfully better:** (1) trustworthy advertiser resolution, (2) creative dedup + winner ranking, (3) keep the AI brief/counter-moves as the signature. That trio beats incumbents *on the specific job of "analyze this one competitor and tell me how to win"* — without rebuilding their entire library.

---

## Phase 4 — Wow Moments (top insight types, ranked)

Ranked by "I've never seen this / this alone saved me an hour":

1. **678 ads → 12 creatives:** duplication collapse showing true creative count.
2. **Spend-concentration proxy:** % of active ads behind the single most-duplicated creative (42% on one hook for Solace).
3. **Longest-running creative = proven winner** (persistence beats guesswork).
4. **Hook-frequency leaderboard** across the whole account.
5. **Message-cluster taxonomy** (entitlement vs grievance vs money-defense).
6. **Funnel-stage mix** (94% conversion → "harvesting, not creating demand").
7. **Villain/angle detection** ("denied by an algorithm").
8. **10×6 competitor counter-play pack** (messaging/creative/concepts/hooks/LPs/positioning).
9. **New-creative-this-week delta** (requires tracking — not built).
10. **Creative fatigue signal** (creatives dropped after N days — requires tracking).
11. Format mix (carousel vs single) weighted by *volume*, not count.
12. Compliance-risk flags on regulated claims (healthcare/finance) — unique to our AI layer.
13. Offer taxonomy (free/covered vs discount vs trial).
14. CTA-verb distribution.
15. "Competitor is testing X angle heavily right now" early-warning.
16. Emotional-appeal dominance map.
17. Objection-handling coverage (what they answer vs ignore → your opening).
18. Audience-implied-by-creative personas.
19. Geographic/currency spread (we see USD/EUR/VND/NGN in payloads).
20. Batch-cadence detection (weekly creative refresh → their production tempo).
21. Which product line gets the most ad volume (budget signal).
22. Trust-signal inventory (what proof they use).
23. Landing-page recurring-benefit extraction (scraper + fetch).
24. Cross-competitor comparison (run N brands, diff them).
25. "Whitespace" finder — angles nobody in the category is running.

Items 1–8, 11–14, 16–17, 20–22 are achievable from data we can already get; 9–10, 15, 23–25 need tracking/scraper/multi-run features (roadmap).

---

## Phase 5 — Product Roadmap (value × revenue × effort)

Prioritized by willingness-to-pay per unit effort, NOT by engineering interest.

### Version 1.0 — "Trust & Signal" (ship-blocking)
1. **Advertiser Resolver + confidence gating** — value 10 / revenue 10 / effort 4. *Built in Phase 7.* Without it nothing else matters.
2. **Creative dedup + winner ranking** (collapse by normalized creative; rank by duplication & runtime) — value 9 / revenue 8 / effort 3.
3. **Volume-weighted aggregations** (hook leaderboard, cluster taxonomy, funnel mix, format mix) — value 9 / revenue 8 / effort 3.
4. **Kill/geo-correct `estimated_total_count`**; report true unique-creative and page-scoped counts — value 6 / revenue 5 / effort 1.

### Version 1.1 — "Depth" (raises price ceiling)
5. **Verified full-creative capture** (harden the scraper; measure runtime; snapshot fallback) — value 9 / revenue 8 / effort 7. *The untested-risk retirement.*
6. **Landing-page analysis** (fetch + AI audit of the destination) — value 8 / revenue 7 / effort 5.
7. **Compliance-risk flags** for regulated verticals — value 6 / revenue 6 / effort 3.
8. **Hybrid data source** (API for discovery + scraper for depth, behind one interface) — value 7 / revenue 5 / effort 5.

### Version 2.0 — "Moat" (retention & expansion revenue)
9. **Change tracking + weekly alerts** ("3 new creatives, 1 killed") — value 10 / revenue 9 / effort 8. Turns one-off reports into a subscription.
10. **Multi-competitor comparison & category whitespace** — value 9 / revenue 8 / effort 6.
11. **Saved boards / swipe files / sharing** — value 7 / revenue 6 / effort 6 (table stakes vs incumbents).
12. **Web dashboard over the JSON exports** — value 7 / revenue 6 / effort 8.

---

## Phase 6 — Launch Readiness Checklist

Evaluated as if charging next week.

**Bugs / correctness**
- [ ] 🔴 Advertiser resolution unreliable (72% wrong) — *addressed in Phase 7*
- [ ] 🔴 No creative-level dedup (volume inflated ~50×)
- [ ] 🟠 `estimated_total_count` surfaced as if meaningful
- [ ] 🟠 Franchise multi-page brands pick one page arbitrarily

**Missing features (for paid)**
- [ ] 🔴 Verified full-creative capture at scale (scraper untested live)
- [ ] 🟠 Landing-page analysis
- [ ] 🟠 Change tracking (the subscription hook)

**Trust**
- [ ] 🔴 Must show a confidence level + let the user confirm the advertiser before spending a run
- [ ] 🟠 Every "Not Available" must be explained (done in Solace report — keep it)
- [ ] 🟢 No fabricated metrics (already enforced)

**Performance**
- [ ] 🟠 Measure real scraper runtime & failure rate on 20+ live advertisers
- [ ] 🟢 Per-ad failure isolation already implemented

**UX**
- [ ] 🟠 Non-technical users need more than a CLI (dashboard = V2)
- [ ] 🟢 Outputs (CSV/JSON/MD/PDF) already clean and organized

🔴 = blocks launch · 🟠 = needed soon after · 🟢 = done

---

## Bottom line for the founder

We do **not** need to build more software to find out if people would pay — we need to fix the **one** thing that makes the existing engine trustworthy. The AI brief + counter-play generation is a real differentiator incumbents don't have. The gap is that it too often points at the wrong target. Phase 7 closes that gap.
