# Intelligence-Layer Redesign — Making the Report the Reason People Buy

**Scope:** the *thinking* only — `src/prompts/ad-analysis-prompt.ts` and `src/prompts/company-report-prompt.ts`. Backend and frontend unchanged. The report structure (14 sections), schema, renderer, and pipeline are untouched; what changed is the reasoning the model is required to perform.

## 1. Why the old reports were weak (diagnosis)

The previous system prompt was a list of *rules* ("cite specifics", "no generic advice") with no *method*. Specific failures:

| Weakness | Why it produced worthless output |
| --- | --- |
| No reasoning method | The model was told what not to do, never *how to think*. It defaulted to competent, generic synthesis. |
| Ignored the one high-value signal | **Duplication × runtime = conviction = what actually works** was never used as the reasoning spine. Reports treated all creatives equally instead of reading the account like a P&L. |
| No negative-space method | "What's NOT being said" is the most valuable competitive-intel output, but there was no *category-expectation baseline* step, so the model couldn't find whitespace. |
| Psychology as moods | "Emotional triggers: fear, trust" — generic labels, not named mechanisms tied to the exact line that fires them. |
| Sections asked for description | "hookDistribution: interpret the numbers" → the model *restated* the numbers. That's why distributions felt meaningless. |
| No obviousness filter | Nothing forced rejection of the 60-second-discoverable observation, so reports stated the visible. |
| Garbage-in | The per-ad prompt emitted vague tokens that aggregated into meaningless distributions. |

## 2. The redesigned thinking (architecture)

### Per-ad extraction (`ad-analysis-prompt.ts`)
Two non-negotiable rules now govern it: **quote, don't summarize** (hooks/offers/proof/objections must be the ad's actual words), and **name the mechanism, don't label the mood** (each emotional trigger is a named behavioral lever + the line that fires it). Sharper signal in → meaningful distributions out.

### Company briefing (`company-report-prompt.ts`)
A full reasoning architecture replaces the rule list:

1. **Persona stack made operative** — McKinsey strategist + ex-Meta ads strategist + agency owner + behavioral scientist + A-list copywriter, framed as "the report *is* the product."
2. **Conviction-first reasoning** — the prompt teaches the one thing most analysts miss: in the Ad Library, duplication × runtime is the only visible proxy for budget conviction. What they *scale* reveals what *works*; what they drop reveals what *failed*; what they never test reveals a *blind spot*. Every section reasons from this.
3. **A 7-step private reasoning process** the model must run before writing: Conviction Map → Psychology Decode (named mechanism + quoted line) → Funnel/Segment Reconstruction → **Negative Space** (build the category-expectation baseline, then flag what's conspicuously absent) → Strategic Tells → The Attack → **Self-Critique** (delete anything obvious, unsupported, or buzzword-laden).
4. **An enforced bar** — every claim cites a quoted line, a number, a named creative, or a named geography; each section carries ≥1 "I never noticed that" inference; the 60-second test cuts the obvious.
5. **A banned list with teeth** — placeholders/"x"/empty sections, generic advice, obvious observations, and a named buzzword blacklist (synergy, leverage-as-verb, holistic, best-in-class, unlock, double-down, north star).
6. **Weak-vs-strong calibration** — the prompt shows the model paired examples so it targets the right column.
7. **A conviction-weighted evidence digest** — the user prompt now ranks creatives by duplication × runtime (not input order), states the concentration ("the #1 creative runs across ~X% of volume — scaling one winner or spraying?"), surfaces the active time-span, and includes full copy + the sharpened per-ad reads. It provokes interpretation instead of restatement.

## 3. Acceptance rubric (grade every real report against this)

A report is commercially valuable only if it scores yes on all of these:

1. **Conviction reasoning** — does it identify the scaled winner(s) by duplication/runtime and infer strategy from them (not just list creatives)?
2. **Named psychology + quote** — at least two dominant mechanisms named and tied to the exact line that fires them?
3. **Negative space** — does it state what the category expects and flag what this advertiser conspicuously omits?
4. **Non-obvious per section** — does each section contain an inference a marketer would miss at a glance?
5. **Evidence everywhere** — is every conclusion anchored to a quote, a number, a named creative, or a geography?
6. **Actionable attack** — is the counter-strategy 3-5 concrete plays, each tied to a specific evidenced weakness?
7. **Zero filler** — no "x", no empty sections, no buzzwords, no 60-second-obvious lines.

The worked example that meets this bar on real data (24 Gracey Care ads) is `validation/samples/gold-standard-gracey-care.md` — e.g. it surfaces the geo-rotation across low-cost Mountain-West states, the fact that emotion *beat the offer* in their own testing, and the total absence of proof as the attack surface. None of that is discoverable in 60 seconds.

## 4. Verification & limits

- The intelligence spec is version-locked by `tests/prompt-contract.test.ts` (13 assertions): if the prompting is weakened back toward "summarize the ads", the build fails.
- The redesign is prompt-only; schema, renderer, and the 14-section structure are unchanged, so all 119 tests still pass and no backend/frontend code moved.
- **Honest limit:** this sandbox has no LLM key, so the redesigned prompt could not be run against a live model here. The gold-standard example demonstrates the achievable bar on the same real data the prompt will see, and the acceptance rubric above is how to grade the first live outputs. Run 3 real companies with a live key and grade them against §3; iterate on any section that scores "no".
