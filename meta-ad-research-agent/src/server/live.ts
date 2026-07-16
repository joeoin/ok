import type { AdvertiserPage, AnalyzedAd, CreativeGroup, ResearchResult } from '../types.js';
import type { AppConfig } from '../config.js';
import { BrowserManager } from '../browser/browser-manager.js';
import { AdLibraryScraper } from '../scraper/ad-library-scraper.js';
import { AdAnalyzer } from '../analyzer/ad-analyzer.js';
import { createLlmClient } from '../analyzer/llm-client.js';
import { groupCreatives } from '../analyzer/creative-grouper.js';
import { computeAggregates } from '../analyzer/aggregate.js';
import { computeReliability } from '../analyzer/reliability.js';
import { generateCompanyReport } from '../reporting/report-generator.js';
import { createLogger } from '../utils/logger.js';
import type { AnalyzeInput, ProgressFn } from './orchestrator.js';

const log = createLogger('live');

/** The Meta Ad Library could not be reached from this server. */
export class MetaUnreachableError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'MetaUnreachableError';
  }
}

/** Classify a scraper/browser failure into an honest, user-facing error. */
export function classifyError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    /ERR_TUNNEL|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_PROXY|ERR_ABORTED|ERR_SOCKET|net::|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|TimeoutError|Timeout \d|navigation|403|407|502/i.test(
      msg,
    )
  ) {
    return new MetaUnreachableError(
      `The Meta Ad Library could not be reached from this server (${firstLine(msg)}). ` +
        'This usually means the machine running the app cannot open facebook.com — check the network/egress policy, ' +
        'proxy, or firewall. No results were fabricated.',
    );
  }
  if (/Executable doesn't exist|Failed to launch|browserType.launch|spawn/i.test(msg)) {
    return new MetaUnreachableError(
      `The headless browser could not start (${firstLine(msg)}). ` +
        'Run "npx playwright install chromium" or set CHROMIUM_PATH to a Chromium binary.',
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

const firstLine = (s: string): string => s.split('\n')[0]!.slice(0, 180);

/**
 * A shared browser for the server process. Started lazily, reused across
 * requests (each request opens its own page). Never falls back to demo data.
 */
export class LiveEngine {
  private browser: BrowserManager | null = null;
  private starting: Promise<BrowserManager> | null = null;

  /** `injectedBrowser` (already started) is only used by tests to mock Meta. */
  constructor(
    private readonly config: AppConfig,
    private readonly injectedBrowser?: BrowserManager,
  ) {}

  private async browserInstance(): Promise<BrowserManager> {
    if (this.injectedBrowser) return this.injectedBrowser;
    if (this.browser) return this.browser;
    if (!this.starting) {
      const b = new BrowserManager({
        headless: this.config.scraper.headless,
        timeoutMs: this.config.scraper.timeoutMs,
        executablePath: this.config.scraper.chromiumPath,
      });
      this.starting = b
        .start()
        .then(() => {
          this.browser = b;
          return b;
        })
        .catch((e) => {
          this.starting = null;
          throw classifyError(e);
        });
    }
    return this.starting;
  }

  private scraper(browser: BrowserManager): AdLibraryScraper {
    return new AdLibraryScraper(browser, this.config.scraper);
  }

  /** Live advertiser search via the real scraper. Throws honest errors. */
  async search(query: string): Promise<AdvertiserPage[]> {
    const browser = await this.browserInstance();
    try {
      return await this.scraper(browser).searchAdvertisers(query);
    } catch (e) {
      throw classifyError(e);
    }
  }

  /**
   * Live analysis for a chosen advertiser, emitting real per-stage progress.
   * Deduplicates first, then analyzes one representative per unique creative
   * (the analysis is shared across its duplicates) — faithful to the engine
   * and far cheaper than analyzing every duplicate ad ID.
   */
  async analyze(input: AnalyzeInput, onProgress: ProgressFn): Promise<ResearchResult> {
    const browser = await this.browserInstance();
    const scraper = this.scraper(browser);
    const collectedAt = new Date().toISOString();

    onProgress('resolving', 'done', `${input.page.name} · ${input.resolutionConfidencePct}% confidence`);

    // 1) Collect.
    onProgress('collecting', 'active', 'Reading the Meta Ad Library');
    let rawAds;
    let page;
    try {
      ({ ads: rawAds, page } = await scraper.collectAds(input.page));
    } catch (e) {
      throw classifyError(e);
    }
    await page.close().catch(() => undefined);
    const metaReportedApprox = scraper.lastReportedResultCount;
    onProgress('collecting', 'done', `${rawAds.length} active ads collected`);

    if (rawAds.length === 0) {
      throw new NoAdsError(input.page.name);
    }

    // 2) Deduplicate (analysis attached after).
    onProgress('deduplicating', 'active', 'Collapsing duplicate creatives');
    const skeleton = groupCreatives(
      rawAds.map((ad) => ({ ad, analysis: null, analysisError: null })),
      { asOf: collectedAt },
    );
    onProgress('deduplicating', 'done', `${rawAds.length} ads → ${skeleton.length} unique creatives`);

    // 3) Analyze one representative per unique creative.
    const llm = createLlmClient(this.config.llm);
    onProgress('analyzing', 'active', llm ? 'Analyzing hooks, offers, psychology' : 'AI analysis disabled (no LLM key)');
    const analyzer = new AdAnalyzer(llm, this.config.llm.concurrency);
    const analyzedReps = await analyzer.analyzeAll(skeleton.map((g) => g.representative));
    const analysisByRepId = new Map(analyzedReps.map((a) => [a.ad.adArchiveId, a]));
    const groups: CreativeGroup[] = skeleton.map((g) => {
      const rep = analysisByRepId.get(g.representative.adArchiveId);
      return { ...g, analysis: rep?.analysis ?? null, analysisError: rep?.analysisError ?? null };
    });
    // Propagate each creative's analysis to all of its member ads for exports.
    const analysisByAdId = new Map<string, AnalyzedAd['analysis']>();
    for (const g of groups) for (const id of g.adArchiveIds) analysisByAdId.set(id, g.analysis);
    const ads: AnalyzedAd[] = rawAds.map((ad) => ({
      ad,
      analysis: analysisByAdId.get(ad.adArchiveId) ?? null,
      analysisError: null,
    }));
    onProgress('analyzing', 'done', `${groups.length} creatives analyzed`);

    // 4) Report + reliability.
    onProgress('reporting', 'active', 'Writing the executive briefing');
    const aggregates = computeAggregates(groups);
    const { report, error: reportError } = await generateCompanyReport(
      llm,
      input.page,
      groups,
      aggregates,
      metaReportedApprox,
    );
    const reliability = computeReliability({
      ads,
      groups,
      advertiserConfidencePct: input.resolutionConfidencePct,
      metaReportedApprox,
      dataSource: 'Meta Ad Library — live browser scraper (public data only)',
      analysisEnabled: this.config.llm.provider !== 'none',
    });
    onProgress('reporting', 'done', 'Executive briefing ready');
    onProgress('done', 'done');

    return {
      advertiser: input.page,
      searchQuery: input.query,
      searchCountry: this.config.scraper.country,
      collectedAt,
      ads,
      creativeGroups: groups,
      report,
      reportError,
      reliability,
      advertiserResolution: {
        confidencePct: input.resolutionConfidencePct,
        method: input.resolutionMethod,
        reasons: input.resolutionReasons,
      },
      adVolume: {
        collectedAds: ads.length,
        uniqueCreatives: groups.length,
        metaReportedApprox,
        fullyCollected: metaReportedApprox !== null && ads.length >= metaReportedApprox,
      },
    };
  }

  async close(): Promise<void> {
    await this.browser?.stop().catch(() => undefined);
    this.browser = null;
  }
}

/** Raised when an advertiser page exists but is running no active ads. */
export class NoAdsError extends Error {
  constructor(name: string) {
    super(`${name} has no active ads in the Meta Ad Library right now, so there is nothing to analyze.`);
    this.name = 'NoAdsError';
  }
}

let engine: LiveEngine | null = null;
export function getLiveEngine(config: AppConfig): LiveEngine {
  if (!engine) {
    engine = new LiveEngine(config);
    log.info('Live engine ready (real Meta Ad Library scraper).');
  }
  return engine;
}
