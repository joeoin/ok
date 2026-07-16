import type { AppConfig } from './config.js';
import type { AdvertiserPage, AdvertiserResolutionInfo, ResearchResult } from './types.js';
import { BrowserManager } from './browser/browser-manager.js';
import { AdLibraryScraper } from './scraper/ad-library-scraper.js';
import { AdAnalyzer } from './analyzer/ad-analyzer.js';
import { createLlmClient } from './analyzer/llm-client.js';
import { groupCreatives } from './analyzer/creative-grouper.js';
import { computeAggregates } from './analyzer/aggregate.js';
import { computeReliability } from './analyzer/reliability.js';
import { generateCompanyReport } from './reporting/report-generator.js';
import { exportCsv } from './reporting/csv-exporter.js';
import { writeMarkdownReport } from './reporting/markdown-report.js';
import { AssetStore } from './storage/asset-store.js';
import { saveResultJson } from './storage/result-store.js';
import { resolveAdvertiser, type ScoredCandidate } from './resolver/advertiser-resolver.js';
import type { AdvertiserCache } from './resolver/advertiser-cache.js';
import { runTimestamp } from './utils/fs.js';
import { selectFromList } from './utils/select.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('pipeline');

export interface PipelineOutput {
  result: ResearchResult;
  files: { csv: string; json: string; markdown: string };
}

export interface PipelineHooks {
  /** Runs right after the browser starts — for route mocking in tests, or
   * injecting cookies/consent state in future integrations. */
  onBrowserStarted?: (browser: BrowserManager) => Promise<void>;
  /** Optional historical advertiser cache (persisted across runs). */
  cache?: AdvertiserCache;
}

/**
 * End-to-end research run:
 * search advertiser -> collect ads -> assets -> AI analysis -> report -> exports.
 */
export async function runResearch(
  query: string,
  config: AppConfig,
  hooks: PipelineHooks = {},
): Promise<PipelineOutput> {
  const browser = new BrowserManager({
    headless: config.scraper.headless,
    timeoutMs: config.scraper.timeoutMs,
    executablePath: config.scraper.chromiumPath,
  });
  await browser.start();

  try {
    await hooks.onBrowserStarted?.(browser);
    const scraper = new AdLibraryScraper(browser, config.scraper);

    // Step 1 — resolve the advertiser (interactive choice when ambiguous).
    const advertisers = await scraper.searchAdvertisers(query);
    if (advertisers.length === 0) {
      throw new Error(
        `No advertisers found in the Meta Ad Library for "${query}". ` +
          'Check the spelling, or try a different AD_LIBRARY_COUNTRY.',
      );
    }
    const { advertiser, resolution } = await chooseAdvertiser(query, advertisers, hooks.cache);
    log.info(`Researching advertiser: ${advertiser.name} (page ${advertiser.pageId})`);

    // Step 2 — collect every active ad.
    const { ads, page } = await scraper.collectAds(advertiser);
    if (ads.length === 0) {
      log.warn('No active ads found for this advertiser.');
    }

    const store = new AssetStore(config.output.rootDir, advertiser.name, runTimestamp());

    // Step 3 — creative assets.
    if (config.output.screenshots && ads.length > 0) {
      const shots = await scraper.screenshotAds(page, ads);
      await store.saveScreenshots(ads, shots);
    }
    await page.close().catch(() => undefined);
    if (config.output.downloadImages && ads.length > 0) {
      await store.downloadImages(ads);
    }

    // Step 4 — per-ad AI analysis.
    const llm = createLlmClient(config.llm);
    if (config.llm.provider !== 'none' && !config.llm.apiKey) {
      log.warn('LLM_API_KEY is empty — hosted providers will reject requests (local servers may not).');
    }
    const analyzer = new AdAnalyzer(llm, config.llm.concurrency);
    const analyzedAds = await analyzer.analyzeAll(ads);

    // Step 5 — deduplicate into creative groups (the real unit of analysis).
    const collectedAt = new Date().toISOString();
    const creativeGroups = groupCreatives(analyzedAds, { asOf: collectedAt });
    const aggregates = computeAggregates(creativeGroups);
    log.info(`Collapsed ${analyzedAds.length} ads → ${creativeGroups.length} unique creatives`);

    // Verifiable ad-volume figures. metaReportedApprox is Meta's OWN UI count
    // (scraped), never the API's unverifiable estimated_total_count.
    const metaReportedApprox = scraper.lastReportedResultCount;
    const adVolume = {
      collectedAds: analyzedAds.length,
      uniqueCreatives: creativeGroups.length,
      metaReportedApprox,
      fullyCollected: metaReportedApprox !== null && analyzedAds.length >= metaReportedApprox,
    };

    // Step 6 — executive briefing from deduplicated creatives.
    const { report, error: reportError } = await generateCompanyReport(
      llm,
      advertiser,
      creativeGroups,
      aggregates,
      metaReportedApprox,
    );

    // Step 7 — reliability scoring.
    const reliability = computeReliability({
      ads: analyzedAds,
      groups: creativeGroups,
      advertiserConfidencePct: resolution.confidencePct,
      metaReportedApprox,
      dataSource: 'Meta Ad Library — browser scraper (public data only)',
      analysisEnabled: config.llm.provider !== 'none',
    });

    const result: ResearchResult = {
      advertiser,
      searchQuery: query,
      searchCountry: config.scraper.country,
      collectedAt,
      ads: analyzedAds,
      creativeGroups,
      report,
      reportError,
      reliability,
      advertiserResolution: resolution,
      adVolume,
    };

    // Persist the resolution so future runs skip the ambiguity.
    if (hooks.cache && advertiser.pageId) {
      hooks.cache.remember(query, { pageId: advertiser.pageId, name: advertiser.name }, collectedAt);
    }

    // Outputs — CSV (deduped creatives), JSON, Markdown.
    const files = {
      csv: await exportCsv(store, creativeGroups),
      json: await saveResultJson(store, result),
      markdown: await writeMarkdownReport(store, result),
    };
    return { result, files };
  } finally {
    await browser.stop();
  }
}

/**
 * Resolve the query to a single advertiser with confidence gating.
 * - high-confidence unique match  -> auto-accept
 * - ambiguous / franchise / ties  -> present a ranked, confidence-labeled choice
 * - only impersonators/noise      -> refuse (never analyze the wrong company)
 */
interface ChosenAdvertiser {
  advertiser: AdvertiserPage;
  resolution: AdvertiserResolutionInfo;
}

async function chooseAdvertiser(
  query: string,
  advertisers: AdvertiserPage[],
  cache?: AdvertiserCache,
): Promise<ChosenAdvertiser> {
  const decision = resolveAdvertiser(query, advertisers, cache ? { cache } : {});

  if (decision.kind === 'refuse') {
    throw new Error(decision.reason);
  }

  if (decision.kind === 'accept') {
    log.info(
      `Matched "${query}" → ${decision.chosen.name} ` +
        `(confidence ${decision.candidate.confidencePct}%; ${decision.candidate.reasons.join(', ')})`,
    );
    return {
      advertiser: decision.chosen,
      resolution: {
        confidencePct: decision.candidate.confidencePct,
        method: 'auto-accepted',
        reasons: decision.candidate.reasons,
      },
    };
  }

  if (decision.franchisePrefix) {
    log.info(`"${query}" looks like a franchise ("${decision.franchisePrefix}") — asking which page to research.`);
  }
  const index = await selectFromList(
    `Multiple advertisers could match "${query}" — which one should I research?`,
    decision.candidates.map((c: ScoredCandidate) => ({
      label: `${c.page.name}  [${c.confidencePct}% match]`,
      detail: [
        c.page.category,
        c.page.verification?.toUpperCase().includes('VERIF') ? 'verified' : null,
        c.page.likes ? `${c.page.likes.toLocaleString()} likes` : null,
        `page ${c.page.pageId}`,
      ]
        .filter(Boolean)
        .join(', '),
    })),
  );
  const chosen = decision.candidates[index]!;
  return {
    advertiser: chosen.page,
    resolution: { confidencePct: chosen.confidencePct, method: 'user-selected', reasons: chosen.reasons },
  };
}
