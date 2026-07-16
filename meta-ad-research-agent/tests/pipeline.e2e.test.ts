import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runResearch } from '../src/pipeline.js';
import type { AppConfig } from '../src/config.js';
import { legacyPayload } from './fixtures.js';

/**
 * Full pipeline run against a mocked Ad Library with AI analysis disabled:
 * advertiser resolution (keyword fallback) -> collection -> screenshots ->
 * CSV/JSON/Markdown exports on disk.
 */
describe('runResearch (mocked Ad Library, LLM disabled)', () => {
  let outDir: string;

  beforeAll(async () => {
    outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ad-research-e2e-'));
  });

  afterAll(async () => {
    await fs.rm(outDir, { recursive: true, force: true });
  });

  it('produces CSV, JSON, and Markdown outputs', async () => {
    const config: AppConfig = {
      llm: { provider: 'none', apiKey: '', baseUrl: '', model: '', concurrency: 1 },
      scraper: {
        headless: true,
        chromiumPath: process.env['CHROMIUM_PATH'] ?? '',
        country: 'ALL',
        maxAds: 10,
        timeoutMs: 15_000,
        scrollIdleMs: 1500,
      },
      output: { rootDir: outDir, screenshots: true, downloadImages: false },
      logLevel: 'warn',
    };

    const { result, files } = await runResearch('Acme Solar', config, {
      onBrowserStarted: async (browser) => {
        const context = browser.getContext();
        await context.route('https://www.facebook.com/ads/library/**', async (route) => {
          await route.fulfill({
            contentType: 'text/html',
            body: `<!doctype html><html><body>
              <div style="width:400px;padding:12px"><span>Library ID: 1234567890</span></div>
              <script>fetch('/ads/library/async/search_ads?q=acme');</script>
            </body></html>`,
          });
        });
        await context.route('https://www.facebook.com/ads/library/async/search_ads**', async (route) => {
          await route.fulfill({
            contentType: 'application/json',
            body: 'for (;;);' + JSON.stringify(legacyPayload),
          });
        });
      },
    });

    expect(result.advertiser.pageId).toBe('111222333444');
    expect(result.ads).toHaveLength(1);
    expect(result.report).toBeNull();
    // Dedup + reliability wired through.
    expect(result.creativeGroups).toHaveLength(1);
    expect(result.creativeGroups[0]!.duplicateCount).toBe(1);
    expect(result.reliability.advertiserConfidence).toBeGreaterThan(90);
    expect(result.advertiserResolution.method).toBe('auto-accepted');

    const csv = await fs.readFile(files.csv, 'utf8');
    expect(csv.split('\r\n')[0]).toContain('creativeId');
    expect(csv.split('\r\n')[0]).toContain('duplicateCount');
    expect(csv).toContain('1234567890'); // exampleAdId

    const json = JSON.parse(await fs.readFile(files.json, 'utf8'));
    expect(json.ads[0].ad.adArchiveId).toBe('1234567890');
    expect(json.creativeGroups[0].creativeId).toMatch(/^cg_/);
    expect(json.reliability.overall).toBeGreaterThan(0);

    const md = await fs.readFile(files.markdown, 'utf8');
    expect(md).toContain('# Competitive Intelligence Briefing: Acme Solar');
    expect(md).toContain('## Reliability');

    // Screenshot saved and referenced.
    expect(result.ads[0]!.ad.screenshotPath).toMatch(/screenshots[\\/]acme-solar[\\/].*1234567890\.png$/);
    await fs.access(path.join(outDir, result.ads[0]!.ad.screenshotPath!));
  }, 120_000);
});
