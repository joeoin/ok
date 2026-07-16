import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserManager } from '../src/browser/browser-manager.js';
import { AdLibraryScraper } from '../src/scraper/ad-library-scraper.js';
import { legacyPayload } from './fixtures.js';
import type { AdvertiserPage } from '../src/types.js';

/**
 * Full scraper flow with facebook.com mocked via Playwright route
 * interception — no real network. Verifies navigation, XHR sniffing,
 * scroll-driven collection, and per-ad screenshots.
 */
describe('AdLibraryScraper (mocked Ad Library)', () => {
  const browser = new BrowserManager({
    headless: true,
    timeoutMs: 15_000,
    executablePath: process.env['CHROMIUM_PATH'] || undefined,
  });

  const advertiser: AdvertiserPage = {
    pageId: '111222333444',
    name: 'Acme Solar',
    category: null,
    likes: null,
    verification: null,
    imageUri: null,
    country: null,
  };

  beforeAll(async () => {
    await browser.start();
    const context = browser.getContext();

    // Playwright checks routes in reverse registration order, so the generic
    // HTML route goes first and the specific XHR route last.
    await context.route('https://www.facebook.com/ads/library/**', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><body>
          <div id="card" style="width:400px;border:1px solid #ccc;padding:12px">
            <span>Library ID: 1234567890</span>
            <p>Cut your energy bill by 40%.</p>
          </div>
          <script>
            fetch('/ads/library/async/search_ads?page_id=111222333444');
          </script>
        </body></html>`,
      });
    });

    await context.route('https://www.facebook.com/ads/library/async/search_ads**', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: 'for (;;);' + JSON.stringify(legacyPayload),
      });
    });
  }, 60_000);

  afterAll(async () => {
    await browser.stop();
  });

  it('collects ads from sniffed XHR payloads and screenshots the card', async () => {
    const scraper = new AdLibraryScraper(browser, {
      country: 'ALL',
      maxAds: 10,
      timeoutMs: 15_000,
      scrollIdleMs: 1500,
    });

    const { ads, page } = await scraper.collectAds(advertiser);
    expect(ads).toHaveLength(1);
    expect(ads[0]!.adArchiveId).toBe('1234567890');
    expect(ads[0]!.advertiserName).toBe('Acme Solar');
    expect(ads[0]!.status).toBe('active');

    const shots = await scraper.screenshotAds(page, ads);
    expect(shots.size).toBe(1);
    const png = shots.get('1234567890')!;
    // PNG magic bytes.
    expect(png.subarray(1, 4).toString()).toBe('PNG');

    await page.close();
  }, 90_000);
});
