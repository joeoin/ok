import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LiveEngine } from '../src/server/live.js';
import { LlmConfigError } from '../src/analyzer/llm-client.js';
import { BrowserManager } from '../src/browser/browser-manager.js';
import { buildReportView } from '../src/server/report-view.js';
import type { AppConfig } from '../src/config.js';
import type { AdvertiserPage } from '../src/types.js';

/**
 * End-to-end verification of all four bug fixes in one Duolingo-shaped run,
 * against a mocked Meta + mock LLM (the sandbox can't reach the real site or a
 * real key). Proves: LLM auth is verified (P1), placeholders render (P2),
 * tracking-param duplicates collapse (P3), and collection runs to completion (P4).
 */

// 5 ads = same creative with per-ad tracking params (must collapse to 1) +
// 1 DCO carousel whose snapshot title is an unrendered {{placeholder}}.
const AD_PAYLOAD = {
  payload: {
    results: [
      [0, 1, 2, 3, 4].map((i) => ({
        adArchiveID: `dup-${i}`,
        pageID: '111',
        pageName: 'Duolingo',
        publisherPlatform: ['FACEBOOK', 'INSTAGRAM'],
        isActive: true,
        startDate: 1783000000,
        snapshot: {
          page_name: 'Duolingo',
          title: 'Learn a language free',
          body: { text: 'The free, fun, effective way to learn a language.' },
          link_url: `https://duolingo.com/?utm_content=${i}&fbclid=abc${i}`,
          cta_text: 'Install Now',
          display_format: 'IMAGE',
          images: [{ original_image_url: 'https://cdn.example/duo.jpg' }],
        },
      })),
      [
        {
          adArchiveID: 'carousel-1',
          pageID: '111',
          pageName: 'Duolingo',
          publisherPlatform: ['FACEBOOK'],
          isActive: true,
          startDate: 1783000000,
          snapshot: {
            page_name: 'Duolingo',
            title: '{{product.name}}',
            link_url: 'https://duolingo.com/{{product.url}}',
            display_format: 'DCO',
            cards: [
              { title: 'Duolingo Super', link_url: 'https://duolingo.com/super', body: 'Learn 40+ languages' },
              { title: 'Duolingo Max', link_url: 'https://duolingo.com/max', body: 'AI-powered lessons' },
            ],
          },
        },
      ],
    ],
  },
};

const ANALYSIS_JSON = {
  hook: 'Learn a language free', offer: 'Free app', cta: 'Install Now', customerPainPoint: 'Learning is hard',
  desiredOutcome: 'Speak a new language', audience: 'Language learners', funnelStage: 'awareness',
  emotionalTriggers: ['fun'], copywritingFramework: 'benefit', marketingAngle: 'gamified learning',
  creativeStyle: 'mascot', trustSignals: [], socialProof: null, urgency: null, scarcity: null,
  objectionHandling: null, differentiators: ['free'],
};
const REPORT_JSON = {
  executiveSummary: 'Duolingo runs a brand-led, top-of-funnel program.', biggestStrategicInsight: 'bi',
  companyPositioning: 'cp', messagingStrategy: 'm', customerPsychology: 'psy', creativeWinners: 'cw',
  creativeBreakdown: 'cb', hookDistribution: 'hd', offerDistribution: 'od', funnelStrategy: 'f',
  competitiveWeaknesses: 'w', opportunities: 'o', counterStrategy: 'cs', actionItems: 'ai',
};

const page = (over: Partial<AdvertiserPage> = {}): AdvertiserPage => ({
  pageId: '111', name: 'Duolingo', category: 'App Page', likes: null, verification: null, imageUri: null, country: null, website: null, ...over,
});

function configWith(llmUrl: string, provider: 'openai' | 'none' = 'openai'): AppConfig {
  return {
    llm: { provider, apiKey: provider === 'none' ? '' : 'test-key', baseUrl: `${llmUrl}/v1`, model: 'mock', concurrency: 2 },
    scraper: { headless: true, chromiumPath: process.env['CHROMIUM_PATH'] ?? '', country: 'ALL', maxAds: 20, timeoutMs: 15_000, scrollIdleMs: 1500 },
    output: { rootDir: '/tmp', screenshots: false, downloadImages: false },
    logLevel: 'warn',
  };
}

describe('Live Duolingo run — all four fixes end-to-end (mocked Meta + LLM)', () => {
  const browser = new BrowserManager({ headless: true, timeoutMs: 15_000, executablePath: process.env['CHROMIUM_PATH'] || undefined });
  let llm: http.Server;
  let llmUrl: string;
  let llmStatus = 200;

  beforeAll(async () => {
    await browser.start();
    const ctx = browser.getContext();
    await ctx.route('https://www.facebook.com/ads/library/**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><body><div>~6 results</div>
          <script>fetch('/ads/library/async/search_ads?page_id=111');</script></body></html>`,
      });
    });
    await ctx.route('https://www.facebook.com/ads/library/async/search_ads**', async (route) => {
      await route.fulfill({ contentType: 'application/json', body: 'for (;;);' + JSON.stringify(AD_PAYLOAD) });
    });

    llm = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (llmStatus !== 200) {
          res.writeHead(llmStatus, { 'content-type': 'application/json' });
          res.end('{"error":"unauthorized"}');
          return;
        }
        const sys = String(JSON.parse(body).messages?.[0]?.content ?? '');
        const content = JSON.stringify(sys.includes('executive briefing') ? REPORT_JSON : ANALYSIS_JSON);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content } }] }));
      });
    });
    await new Promise<void>((r) => llm.listen(0, '127.0.0.1', r));
    llmUrl = `http://127.0.0.1:${(llm.address() as { port: number }).port}`;
  }, 60_000);

  afterAll(async () => {
    await browser.stop();
    await new Promise<void>((r) => llm.close(() => r()));
  });

  it('verifies auth, collapses tracking-param dupes, renders placeholders, and generates the report', async () => {
    llmStatus = 200;
    const engine = new LiveEngine(configWith(llmUrl), browser);
    const result = await engine.analyze(
      { query: 'Duolingo', page: page(), resolutionConfidencePct: 99, resolutionMethod: 'user-selected', resolutionReasons: ['exact name match'] },
      () => undefined,
    );

    // P3: 6 ads → 2 unique creatives (5 tracking-param dupes collapse to 1, + 1 carousel).
    expect(result.adVolume.collectedAds).toBe(6);
    expect(result.adVolume.uniqueCreatives).toBe(2);
    const top = result.creativeGroups[0]!;
    expect(top.duplicateCount).toBe(5);

    // P2: the carousel creative rendered real card copy, not {{placeholder}}.
    const carousel = result.creativeGroups.find((g) => g.creativeType === 'carousel')!;
    expect(carousel.headline).toBe('Duolingo Super');
    expect(JSON.stringify(result.creativeGroups)).not.toMatch(/\{\{/);

    // P1: auth was verified and the report generated with a real narrative.
    expect(result.report?.executiveSummary).toMatch(/Duolingo/);
    expect(buildReportView(result).report?.counterStrategy).toBe('cs');
  }, 90_000);

  it('fails fast with a friendly config error on a bad key — never a raw 401', async () => {
    llmStatus = 401;
    const engine = new LiveEngine(configWith(llmUrl), browser);
    await expect(
      engine.analyze(
        { query: 'Duolingo', page: page(), resolutionConfidencePct: 99, resolutionMethod: 'user-selected', resolutionReasons: [] },
        () => undefined,
      ),
    ).rejects.toBeInstanceOf(LlmConfigError);
  }, 60_000);
});
