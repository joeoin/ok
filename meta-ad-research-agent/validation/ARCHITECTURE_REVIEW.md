# Architecture Review — V1.0 Backend

Scope: the backend that powers report generation. Reviewed for complexity, duplication, performance, tech debt, scalability, security, and caching.

## Module map (after V1.0)

```
src/
├── browser/        Playwright lifecycle (BrowserManager)
├── scraper/        AdLibraryScraper + NetworkCapture (drive UI, sniff JSON)
├── parser/         raw payload -> AdRecord / AdvertiserPage (both API shapes)
├── resolver/       advertiser resolution + confidence gating + cache   ← V1.0
├── analyzer/       LlmClient, AdAnalyzer, creative-grouper, aggregate,
│                   reliability, schemas                                 ← V1.0
├── prompts/        per-ad + company-report prompt builders
├── reporting/      csv-exporter, markdown-report, report-generator
├── storage/        AssetStore (layout), result-store (JSON)
├── utils/          logger, retry, csv, fs, text, similarity, concurrency, select
├── config.ts       .env load + zod validation
├── types.ts        domain types
└── pipeline.ts     orchestration
```

The pipeline is a clean linear flow with clear seams: resolve → collect → assets → analyze → **dedupe → aggregate → report → score** → export. Each new V1.0 concern is an isolated, independently-tested pure module.

## Findings & actions

| # | Finding | Severity | Action |
| --- | --- | --- | --- |
| 1 | Diacritic-strip + normalize logic duplicated in `fs.slugify` and `resolver.normalizeName` | Low | **Fixed** — extracted `utils/text.ts` (`stripDiacritics`, `normalizeText`); both now delegate. |
| 2 | CSV/JSON/Markdown were per-ad-ID, inflating volume ~50× | High | **Fixed** — everything now keyed on deduplicated Creative Groups. |
| 3 | Advertiser could be chosen silently at low confidence | Critical | **Fixed** — hard 95/70 gating; refuses below 70%. |
| 4 | No trust signal surfaced to the customer | High | **Fixed** — Reliability Layer with explained sub-scores. |
| 5 | `estimated_total_count` treated as meaningful (reported 678 vs Meta UI ~370) | High | **Fixed** — the API estimate is never displayed. Ad counts are provenance-typed (`AdVolume`): only our own directly-counted collected/unique figures, plus Meta's *UI-scraped* "~N results" (attributed, approximate). Coverage is computed only against Meta's figure and renders "Not measured" otherwise — never a fabricated number. |
| 6 | Markdown renderer recomputes aggregates the pipeline already has | Low | **Kept intentionally** — the renderer is pure over `ResearchResult`, so any saved JSON re-renders identically without re-running the pipeline. Recompute cost is negligible (in-memory over ≤ few hundred creatives). |
| 7 | Per-ad screenshots are sequential | Med (perf) | **Documented** — bounded by `MAX_ADS`; parallelizing needs care (shared page/scroll). Deferred to V1.1 with the scraper-hardening work. |
| 8 | Network payloads buffered in memory | Low | Acceptable for realistic ad volumes; `NetworkCapture.drain()` clears between absorb cycles. |

## Complexity & duplication

- No God-objects; the largest file (`ad-parser.ts`) is cohesive normalization logic.
- Pure functions dominate (`scoreCandidate`, `creativeSignature`, `computeAggregates`, `computeReliability`) — trivially unit-testable, no hidden state.
- One deliberate stateful component: `AdvertiserCache` (persisted), isolated behind an interface with in-memory + JSON-file implementations.

## Performance & scalability

- **LLM analysis** is the dominant cost; already concurrency-limited (`LLM_CONCURRENCY`) with per-item failure isolation and retry/backoff.
- **Dedup happens before report synthesis**, so the (expensive) company-report prompt sees ~12 creatives instead of ~678 ads — a large token/cost reduction that also improves quality.
- **Ranking/aggregation** are O(n) / O(n log n) over creatives — negligible.
- Scaling to batch/multi-tenant: the pipeline is stateless per run except the cache; it parallelizes across advertisers by construction. A queue + worker model drops in without touching core modules (V2.0).

## Security

- No secrets logged; the LLM API key is read from env and never printed. The empty-key case only warns.
- Generated reports/exports/screenshots are git-ignored; the cache lives under `OUTPUT_DIR/config`.
- External inputs (ad copy, LLM output) are treated as untrusted: LLM JSON is schema-validated (zod) with tolerant coercion and retry; HTML in ad bodies is stripped in the parser.
- No `eval`, no dynamic `require`, no shell execution in the report path.
- Outbound: only the Ad Library (browser) and the configured LLM endpoint.

## Caching

- **Advertiser resolution cache** (new) short-circuits discovery for confirmed brands — instant, stable, and recovers brands keyword-search can't surface.
- Future: cache raw Ad Library payloads per advertiser+day to make re-runs and change-tracking (V2.0) cheap.

## Verdict

The backend is modular, well-typed (strict TS, `noUncheckedIndexedAccess`), and covered by 78 tests. The V1.0 concerns are isolated pure modules with no cross-contamination. The one structural risk is not in this code — it's the **live scraper**, which cannot be exercised in this environment (see Production Readiness).
