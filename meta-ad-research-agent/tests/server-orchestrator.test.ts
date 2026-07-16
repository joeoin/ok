import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { searchAdvertiser } from '../src/server/orchestrator.js';
import { LiveEngine, classifyError, MetaUnreachableError } from '../src/server/live.js';
import { BrowserManager } from '../src/browser/browser-manager.js';
import { ReportStore } from '../src/server/store.js';
import { buildReportView } from '../src/server/report-view.js';
import type { AppConfig } from '../src/config.js';
import type { AdvertiserPage } from '../src/types.js';
import { legacyPayload } from './fixtures.js';

const page = (name: string, over: Partial<AdvertiserPage> = {}): AdvertiserPage => ({
  pageId: over.pageId ?? name.replace(/\W/g, ''),
  name,
  category: over.category ?? null,
  likes: over.likes ?? null,
  verification: over.verification ?? null,
  imageUri: null,
  country: null,
  website: over.website ?? null,
});

describe('searchAdvertiser — real resolver over live pages (no demo data)', () => {
  it('auto-accepts a clean exact match', () => {
    const r = searchAdvertiser('Manscaped', [page('MANSCAPED', { pageId: '1', verification: 'BLUE_VERIFIED' }), page('Random Store', { pageId: '2' })]);
    expect(r.outcome).toBe('auto');
    expect(r.chosenPageId).toBe('1');
  });
  it('asks the user when several real companies share the name', () => {
    const r = searchAdvertiser('Solace', [page('Solace', { pageId: '1', category: 'Medical' }), page('Solace Clothing', { pageId: '2' }), page('Solace Caskets', { pageId: '3' })]);
    expect(r.outcome).toBe('choose');
  });
  it('refuses when only impersonators/coincidental matches exist', () => {
    const r = searchAdvertiser('HubSpot', [page('Rapid Drama Hub', { pageId: '1' }), page('MTE BridgeSaw', { pageId: '2' })]);
    expect(r.outcome).toBe('refuse');
  });
});

describe('classifyError — honest Meta-unreachable detection', () => {
  it('classifies network failures as MetaUnreachableError', () => {
    expect(classifyError(new Error('page.goto: net::ERR_TUNNEL_CONNECTION_FAILED'))).toBeInstanceOf(MetaUnreachableError);
    expect(classifyError(new Error('Timeout 30000ms exceeded'))).toBeInstanceOf(MetaUnreachableError);
  });
  it('classifies browser-launch failures with actionable guidance', () => {
    const e = classifyError(new Error("Executable doesn't exist at /x/chrome"));
    expect(e).toBeInstanceOf(MetaUnreachableError);
    expect((e as MetaUnreachableError).reason).toMatch(/playwright install|CHROMIUM_PATH/);
  });
  it('passes through unrelated errors unchanged', () => {
    const e = new Error('some analyzer bug');
    expect(classifyError(e)).toBe(e);
  });
});

/**
 * Full LIVE path against a mocked Meta (route interception on an injected
 * browser): collect → dedup → analyze → report → reliability → save. Proves
 * the real engine wiring works for an arbitrary advertiser when Meta responds.
 */
describe('LiveEngine.analyze — real engine wiring (mocked Meta)', () => {
  const browser = new BrowserManager({ headless: true, timeoutMs: 15_000, executablePath: process.env['CHROMIUM_PATH'] || undefined });
  let dir: string;

  const config: AppConfig = {
    llm: { provider: 'none', apiKey: '', baseUrl: '', model: '', concurrency: 1 },
    scraper: { headless: true, chromiumPath: process.env['CHROMIUM_PATH'] ?? '', country: 'ALL', maxAds: 10, timeoutMs: 15_000, scrollIdleMs: 1500 },
    output: { rootDir: '/tmp', screenshots: false, downloadImages: false },
    logLevel: 'warn',
  };

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'adintel-live-'));
    await browser.start();
    const ctx = browser.getContext();
    await ctx.route('https://www.facebook.com/ads/library/**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><body>
          <div>~1 results</div>
          <div><span>Library ID: 1234567890</span></div>
          <script>fetch('/ads/library/async/search_ads?page_id=111222333444');</script>
        </body></html>`,
      });
    });
    await ctx.route('https://www.facebook.com/ads/library/async/search_ads**', async (route) => {
      await route.fulfill({ contentType: 'application/json', body: 'for (;;);' + JSON.stringify(legacyPayload) });
    });
  }, 60_000);

  afterAll(async () => {
    await browser.stop();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('produces a real report + saveable result and streams every stage', async () => {
    const engine = new LiveEngine(config, browser);
    const stages: string[] = [];
    const result = await engine.analyze(
      {
        query: 'Acme Solar',
        page: page('Acme Solar', { pageId: '111222333444' }),
        resolutionConfidencePct: 97,
        resolutionMethod: 'user-selected',
        resolutionReasons: ['exact name match'],
      },
      (stage, status) => stages.push(`${stage}:${status}`),
    );

    for (const s of ['collecting', 'deduplicating', 'analyzing', 'reporting', 'done']) {
      expect(stages.some((x) => x.startsWith(s))).toBe(true);
    }
    expect(result.adVolume.collectedAds).toBe(1);
    expect(result.adVolume.uniqueCreatives).toBe(1);
    // Meta's OWN UI figure was read ("~1 results"), not the API estimate.
    expect(result.adVolume.metaReportedApprox).toBe(1);
    expect(result.advertiser.name).toBe('Acme Solar');

    const s = new ReportStore(dir);
    await s.save('acme-live', result);
    const view = buildReportView((await s.get('acme-live'))!.result);
    expect(view.headline.uniqueCreatives).toBe(1);
    expect(view.winners[0]!.headline).toBe('Go Solar, Save Big');
  }, 90_000);
});
