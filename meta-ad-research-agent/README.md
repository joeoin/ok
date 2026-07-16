# Meta Ad Library Research Agent

An AI-powered research agent that takes a company name, finds the advertiser in the **Meta Ad Library**, collects every publicly listed active ad, analyzes each one with an LLM, and generates professional research reports (CSV + JSON + Markdown + organized creative assets).

> **Public data only.** The agent uses the same public Ad Library pages anyone can open in a browser. It never logs in, never bypasses access controls, and never invents private metrics (spend, ROAS, CTR, conversions, audience targeting are *not exposed* by the Ad Library and are always recorded as unavailable).

## How it works

```
npm run research "Nike"
        │
        ▼
┌─────────────────┐   ┌──────────────────┐   ┌───────────────────┐
│ 1. Find page     │ → │ 2. Collect ads    │ → │ 3. Save creatives  │
│  (typeahead +    │   │  (scroll + sniff  │   │  (screenshots,     │
│   user choice)   │   │   JSON payloads)  │   │   image downloads) │
└─────────────────┘   └──────────────────┘   └───────────────────┘
        │
        ▼
┌─────────────────┐   ┌──────────────────┐   ┌───────────────────┐
│ 4. AI analysis   │ → │ 5. Company report │ → │ 6. Exports         │
│  (per-ad JSON:   │   │  (14-section      │   │  (CSV, JSON,       │
│   hook, offer…)  │   │   synthesis)      │   │   Markdown)        │
└─────────────────┘   └──────────────────┘   └───────────────────┘
```

The scraper drives the real Ad Library UI with Playwright but reads data from the JSON payloads the page itself loads (both the legacy `async/search_ads` channel and newer GraphQL responses). This is far more resilient than parsing the DOM, and the payload parser is fully unit-tested against fixtures of both shapes.

## Installation

```bash
cd meta-ad-research-agent
npm install
npx playwright install chromium   # once, unless a system Chromium is configured
cp .env.example .env              # then edit .env
```

Requirements: Node.js ≥ 18.17.

## Web app (customer-facing V1)

A polished single-page app over the engine — the flow a non-technical user follows:

```bash
npm run web          # http://localhost:4321  (MODE=demo by default)
```

Journey: **landing search → smart advertiser resolution (auto-accept / choose / refuse) → live progress → executive report → saved reports**, with PDF + CSV download. It talks to the existing engine (resolver, dedup, aggregates, reliability) unchanged.

- `MODE=demo` (default here) serves the flow from **real advertiser data already collected** (Solace, Nike + real reseller/impersonator candidates), so the whole product is usable where facebook.com is blocked. The UI shows a "Demo data" badge.
- `MODE=live` uses the browser scraper for collection (needs facebook.com reachable + a Chromium binary).
- No auth, billing, or accounts — those are Phase 2 by design.

Frontend: `public/` (vanilla, no build step). Server + orchestration: `src/server/`.

## CLI

```bash
npm run research "Nike"
npm run research "Acme Solar"
```

If several advertiser pages match, the agent lists them and asks you to pick one (in non-interactive environments it auto-selects the best-ranked match).

Run without AI analysis (scrape + export only):

```bash
LLM_PROVIDER=none npm run research "Nike"
```

## Environment variables

All configuration lives in `.env` (see `.env.example` for the full annotated list):

| Variable | Default | Purpose |
| --- | --- | --- |
| `LLM_PROVIDER` | `openai` | `openai` (any OpenAI-compatible API), `anthropic`, or `none` |
| `LLM_API_KEY` | – | API key for the provider |
| `LLM_BASE_URL` | provider default | Override for local/self-hosted models (Ollama, LM Studio, vLLM, OpenRouter) |
| `LLM_MODEL` | `gpt-4o-mini` | Model name |
| `LLM_CONCURRENCY` | `3` | Parallel per-ad analysis calls |
| `HEADLESS` | `true` | Set `false` to watch the browser |
| `CHROMIUM_PATH` | – | Use a pre-installed Chromium binary (CI/sandboxes) |
| `AD_LIBRARY_COUNTRY` | `ALL` | Country scope for the search (`US`, `GB`, …) |
| `MAX_ADS` | `100` | Cap on collected/analyzed ads (`0` = unlimited) |
| `TIMEOUT_MS` | `30000` | Navigation/network timeout |
| `SCROLL_IDLE_MS` | `8000` | Stop scrolling after this long with no new ads |
| `OUTPUT_DIR` | `.` | Root folder for all outputs |
| `SCREENSHOTS` | `true` | Capture per-ad element screenshots |
| `DOWNLOAD_IMAGES` | `true` | Download public creative images / video thumbnails |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |

## Outputs

Each run writes into per-advertiser, per-run folders:

```
exports/<advertiser>/<timestamp>/ads.csv        # one row per ad (scraped + analysis fields)
exports/<advertiser>/<timestamp>/research.json  # complete structured data
reports/<advertiser>/<timestamp>/report.md      # professional Markdown research report
exports/<advertiser>/<timestamp>/creatives.csv # one row per DEDUPLICATED creative
screenshots/<advertiser>/<timestamp>/<adId>.png # per-ad screenshots
downloads/<advertiser>/<timestamp>/<adId>-N.jpg # downloaded creative images / thumbnails
```

Unavailable fields are exported as `Not Available` — never fabricated.

The Markdown report is a 14-section **executive briefing** (in reading order): Executive Summary, Biggest Strategic Insight, Company Positioning, Messaging Strategy, Customer Psychology, Creative Winners, Creative Breakdown, Hook Distribution, Offer Distribution, Funnel Strategy, Competitive Weaknesses, Opportunities, Counter Strategy, Action Items — plus a **Reliability panel**, an **"N ads → M unique creatives"** dedup summary, and a per-creative appendix. See `validation/samples/` for a real example.

## V1.0 trust features

This backend is built so **a customer never receives a report about the wrong company**:

- **Smart Advertiser Resolution** (`src/resolver/`) — a confidence score (0–100) with hard gates: **> 95% auto-accept, 70–95% ranked choices, < 70% refuse** (never silently continues). Signals: exact/fuzzy/substring name match, website/domain, category/industry, verified-page, parent/subsidiary ("AG1 by Athletic Greens"), franchise detection, and a **persistent resolution cache** (`config/advertiser-cache.json`).
- **Creative Deduplication** (`src/analyzer/creative-grouper.ts`) — collapses many ad IDs into distinct Creative Groups ("678 ads → 12 creatives"), ranked by duplication → longevity → coverage, so strategy isn't inflated by copies.
- **Reliability Layer** (`src/analyzer/reliability.ts`) — every report carries overall + advertiser/completeness/coverage/creative-coverage scores and **plain-English explanations of every gap**. Nothing is fabricated; unknowns are labeled.

## Folder structure

```
src/
├── browser/     BrowserManager — Playwright lifecycle, context settings
├── scraper/     AdLibraryScraper + NetworkCapture — drive the UI, sniff JSON payloads
├── parser/      Tolerant payload → AdRecord/AdvertiserPage normalization (both API shapes)
├── resolver/    Advertiser resolution + confidence gating + historical cache
├── analyzer/    LlmClient, AdAnalyzer, creative-grouper, aggregate, reliability, schemas
├── prompts/     System/user prompt builders for per-ad analysis and the briefing
├── reporting/   CSV exporter, Markdown report renderer, company report generator
├── storage/     AssetStore (screenshots/downloads layout), JSON persistence
├── utils/       logger, retry/backoff, csv, fs, text, similarity, concurrency, select
├── config.ts    .env loading + validation (zod)
├── types.ts     Core domain types
├── pipeline.ts  End-to-end orchestration
└── index.ts     CLI entry point
tests/           78 tests — unit + Playwright-mocked integration/e2e
validation/      Product-validation report, architecture review, production readiness, samples
```

## Development

```bash
npm run typecheck   # strict TS
npm test            # unit + integration tests (facebook.com fully mocked — no real network)
```

The integration tests mock the Ad Library with Playwright route interception and the LLM with a local HTTP server, so the whole pipeline is testable offline and in CI.

## Troubleshooting

- **"No advertisers found"** — check spelling; try `AD_LIBRARY_COUNTRY=ALL`; some pages only run ads in specific countries. Set `HEADLESS=false` and `LOG_LEVEL=debug` to watch what happens.
- **Browser fails to launch** — run `npx playwright install chromium`, or point `CHROMIUM_PATH` at an existing Chromium binary.
- **Zero ads collected but the page shows ads** — Meta periodically changes its internal payload format. The parser matches ad nodes structurally (archive id + snapshot) across both known formats; if a new format appears, extend `src/parser/ad-parser.ts` (fixtures + tests make this a contained change).
- **LLM errors / empty analysis** — verify `LLM_API_KEY`/`LLM_BASE_URL`; per-ad failures are recorded in the `analysisError` column and never abort the run.
- **Rate limiting / checkpoint pages from Meta** — slow down (`MAX_ADS`, run less frequently). The agent deliberately does not attempt to bypass CAPTCHAs or access controls; if Meta interrupts the session, re-run later.
- **Consent wall (EU)** — the agent clicks "Decline optional cookies" automatically; if the dialog changes, update `dismissCookieDialog` in `src/scraper/ad-library-scraper.ts`.

## Design notes

- **Network-payload scraping over DOM scraping**: the Ad Library's DOM class names are obfuscated and unstable; its JSON payloads are far more stable and complete. The parser is defensive: it walks any captured payload for ad-shaped objects and tolerates both camelCase and snake_case field styles.
- **Per-item failure isolation**: one bad ad, one failed screenshot, or one malformed LLM response never aborts the run — errors are recorded on the item and surfaced in the outputs.
- **Structured LLM output**: every analysis is validated with zod (including tolerant coercions for `"N/A"` → `null` etc.); invalid responses are retried with a fresh completion.
- **No private data**: prompts explicitly instruct the model that targeting/spend/performance are unknown; the report header states this; exports mark missing fields `Not Available`.

## Future improvements

The module boundaries are designed so these can be added without refactoring the core:

- Additional sources implementing the same scraper interface: Google Ads Transparency Center, TikTok Creative Center, LinkedIn Ads, YouTube Ads
- Landing page analysis (fetch + LLM audit of `landingPageUrl`)
- Competitor comparison reports (run N advertisers, diff the `ResearchResult`s)
- Batch research (`npm run research -- --batch companies.txt`)
- Integrations: Airtable, Google Sheets, Notion (new exporters alongside `reporting/`)
- Database storage (SQLite/PostgreSQL) as an alternative `storage/` backend
- Scheduled recurring research + change detection between runs
- Web dashboard over the JSON exports
- Video download + transcription (isolated worker; Whisper is the natural fit — this is the one component where Python may be preferable, so it should stay a separate process behind a queue)
