import type { AppConfig } from './config.js';
import type { AdvertiserPage, ResearchResult } from './types.js';
import { BrowserManager } from './browser/browser-manager.js';
import { AdLibraryScraper } from './scraper/ad-library-scraper.js';
import { AdAnalyzer } from './analyzer/ad-analyzer.js';
import { createLlmClient } from './analyzer/llm-client.js';
import { generateCompanyReport } from './reporting/report-generator.js';
import { exportCsv } from './reporting/csv-exporter.js';
import { writeMarkdownReport } from './reporting/markdown-report.js';
import { AssetStore } from './storage/asset-store.js';
import { saveResultJson } from './storage/result-store.js';
import { resolveAdvertiser, type ScoredCandidate } from './resolver/advertiser-resolver.js';
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
    const advertiser = await chooseAdvertiser(query, advertisers);
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

    // Step 5 — company-wide synthesis.
    const { report, error: reportError } = await generateCompanyReport(llm, advertiser, analyzedAds);

    const result: ResearchResult = {
      advertiser,
      searchQuery: query,
      searchCountry: config.scraper.country,
      collectedAt: new Date().toISOString(),
      ads: analyzedAds,
      report,
      reportError,
    };

    // Outputs — CSV, JSON, Markdown.
    const files = {
      csv: await exportCsv(store, analyzedAds),
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
async function chooseAdvertiser(query: string, advertisers: AdvertiserPage[]): Promise<AdvertiserPage> {
  const decision = resolveAdvertiser(query, advertisers);

  if (decision.kind === 'refuse') {
    throw new Error(decision.reason);
  }

  if (decision.kind === 'accept') {
    log.info(
      `Matched "${query}" → ${decision.chosen.name} ` +
        `(confidence: ${decision.candidate.confidence}, score ${decision.candidate.score.toFixed(2)}; ` +
        `${decision.candidate.reasons.join(', ')})`,
    );
    return decision.chosen;
  }

  const index = await selectFromList(
    `Multiple advertisers could match "${query}" — which one should I research?`,
    decision.candidates.map((c: ScoredCandidate) => ({
      label: `${c.page.name}  [${c.confidence} match]`,
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
  return decision.candidates[index]!.page;
}
