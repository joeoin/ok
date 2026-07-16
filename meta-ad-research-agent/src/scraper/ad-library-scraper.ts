import type { Page } from 'playwright';
import type { BrowserManager } from '../browser/browser-manager.js';
import { NetworkCapture } from './network-capture.js';
import { extractAds, extractAdvertisers } from '../parser/ad-parser.js';
import type { AdRecord, AdvertiserPage } from '../types.js';
import { createLogger } from '../utils/logger.js';
import { sleep, withRetry } from '../utils/retry.js';

const log = createLogger('scraper');

const AD_LIBRARY_URL = 'https://www.facebook.com/ads/library/';

export interface ScraperOptions {
  country: string;
  maxAds: number;
  timeoutMs: number;
  scrollIdleMs: number;
}

/**
 * Parse the Ad Library UI's own result-count text ("~370 results", "About
 * 1,234 results", "1 result") into a number. Returns null if no count is
 * present. This is Meta's own displayed figure — the only population reference
 * we trust — NOT the API's estimated_total_count.
 */
export function parseReportedResultCount(text: string): number | null {
  const m = text.match(/(?:~|about\s+)?\s*([\d][\d,]{0,11})\s+results?\b/i);
  if (!m) return null;
  const n = Number.parseInt((m[1] as string).replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

export class AdLibraryScraper {
  /**
   * Meta's own approximate result count, read from the Ad Library UI during
   * collection ("~370 results"). Null when it could not be read. Reliability
   * scoring treats null coverage honestly (not-measurable) rather than
   * fabricating a number, and the API's estimated_total_count is never used.
   */
  lastReportedResultCount: number | null = null;

  constructor(
    private readonly browser: BrowserManager,
    private readonly options: ScraperOptions,
  ) {}

  /**
   * Search the Ad Library for advertiser pages matching `query`.
   * Primary path: type into the real search box and harvest the typeahead
   * payloads. Fallback: run a keyword search and group the returned ads by
   * advertiser page.
   */
  async searchAdvertisers(query: string): Promise<AdvertiserPage[]> {
    const page = await this.browser.newPage();
    const capture = new NetworkCapture();
    capture.attach(page);
    try {
      const url = `${AD_LIBRARY_URL}?active_status=active&ad_type=all&country=${encodeURIComponent(this.options.country)}&media_type=all`;
      await withRetry(() => page.goto(url, { waitUntil: 'domcontentloaded' }), {
        attempts: 3,
        onRetry: (e, n) => log.warn(`Ad Library navigation failed (attempt ${n}): ${String(e)}`),
      });
      await this.dismissCookieDialog(page);

      const typed = await this.typeIntoSearchBox(page, query);
      if (typed) {
        // Give the typeahead time to fire and settle.
        await sleep(3500);
      }

      let advertisers = extractAdvertisers(capture.drain());
      if (advertisers.length === 0) {
        log.warn('Typeahead returned no advertiser pages; falling back to keyword search');
        advertisers = await this.advertisersViaKeywordSearch(page, capture, query);
      }

      // Rank exact/prefix name matches first so option 1 is the obvious pick.
      const q = query.toLowerCase();
      advertisers.sort((a, b) => rankMatch(b, q) - rankMatch(a, q));
      log.info(`Found ${advertisers.length} advertiser candidate(s) for "${query}"`);
      return advertisers;
    } finally {
      capture.detach(page);
      await page.close().catch(() => undefined);
    }
  }

  /** Collect all (up to maxAds) active ads for an advertiser page. */
  async collectAds(advertiser: AdvertiserPage): Promise<{ ads: AdRecord[]; page: Page }> {
    const page = await this.browser.newPage();
    const capture = new NetworkCapture();
    capture.attach(page);

    const url =
      `${AD_LIBRARY_URL}?active_status=active&ad_type=all` +
      `&country=${encodeURIComponent(this.options.country)}` +
      `&view_all_page_id=${encodeURIComponent(advertiser.pageId)}` +
      `&search_type=page&media_type=all`;

    log.info(`Loading ads for ${advertiser.name} (page ${advertiser.pageId})`);
    await withRetry(() => page.goto(url, { waitUntil: 'domcontentloaded' }), {
      attempts: 3,
      onRetry: (e, n) => log.warn(`Ads page navigation failed (attempt ${n}): ${String(e)}`),
    });
    await this.dismissCookieDialog(page);
    await sleep(3000);

    // Read Meta's own "~N results" figure from the UI (the only population
    // reference we trust). Best-effort; null if the layout doesn't expose it.
    this.lastReportedResultCount = await this.readReportedResultCount(page);
    if (this.lastReportedResultCount !== null) {
      log.info(`Meta Ad Library reports ~${this.lastReportedResultCount} results for this page`);
    }

    const collected = new Map<string, AdRecord>();
    const absorb = () => {
      for (const ad of extractAds(capture.drain(), this.options.country)) {
        if (advertiser.pageId && ad.pageId && ad.pageId !== advertiser.pageId) continue;
        if (!collected.has(ad.adArchiveId)) collected.set(ad.adArchiveId, ad);
      }
    };

    absorb();
    let idleSince = Date.now();
    let lastCount = collected.size;

    // Infinite-scroll until no new ads arrive for scrollIdleMs or we hit maxAds.
    while (this.options.maxAds === 0 || collected.size < this.options.maxAds) {
      await page.mouse.wheel(0, 2400);
      await sleep(900);
      absorb();

      if (collected.size > lastCount) {
        lastCount = collected.size;
        idleSince = Date.now();
        log.info(`Collected ${collected.size} ads so far…`);
      } else if (Date.now() - idleSince > this.options.scrollIdleMs) {
        log.info('No new ads after scrolling — collection complete');
        break;
      }
    }

    capture.detach(page);
    let ads = [...collected.values()];
    if (this.options.maxAds > 0 && ads.length > this.options.maxAds) {
      ads = ads.slice(0, this.options.maxAds);
    }
    log.info(`Collected ${ads.length} ads for ${advertiser.name}`);
    // The page stays open so the caller can take per-ad screenshots.
    return { ads, page };
  }

  /** Read Meta's "~N results" figure from the Ad Library UI. null on failure. */
  private async readReportedResultCount(page: Page): Promise<number | null> {
    try {
      const el = page.getByText(/\bresults?\b/i).first();
      if ((await el.count()) === 0) return null;
      const text = (await el.innerText({ timeout: 3000 })).slice(0, 200);
      return parseReportedResultCount(text);
    } catch {
      return null;
    }
  }

  /**
   * Screenshot each ad card by locating the "Library ID: <id>" label the UI
   * renders on every card. Returns a map of adArchiveId -> PNG buffer.
   */
  async screenshotAds(page: Page, ads: AdRecord[]): Promise<Map<string, Buffer>> {
    const shots = new Map<string, Buffer>();
    for (const ad of ads) {
      try {
        const label = page.getByText(`Library ID: ${ad.adArchiveId}`, { exact: false }).first();
        if ((await label.count()) === 0) continue;
        await label.scrollIntoViewIfNeeded({ timeout: 5000 });
        // Walk up to the card container: nearest ancestor that is reasonably card-sized.
        const card = label.locator(
          'xpath=ancestor::div[contains(@class,"x1plvlek") or @role="article"][1] | ancestor::div[4]',
        ).first();
        const target = (await card.count()) > 0 ? card : label;
        const buf = await target.screenshot({ timeout: 8000 });
        shots.set(ad.adArchiveId, buf);
      } catch (error) {
        log.debug(`Screenshot failed for ad ${ad.adArchiveId}: ${String(error)}`);
      }
    }
    log.info(`Captured ${shots.size}/${ads.length} ad screenshots`);
    return shots;
  }

  private async dismissCookieDialog(page: Page): Promise<void> {
    const labels = ['Decline optional cookies', 'Only allow essential cookies', 'Allow all cookies'];
    for (const label of labels) {
      try {
        const btn = page.getByRole('button', { name: label }).first();
        if (await btn.isVisible({ timeout: 1500 })) {
          await btn.click();
          log.debug(`Dismissed cookie dialog via "${label}"`);
          return;
        }
      } catch {
        // Button not present — try the next label.
      }
    }
  }

  private async typeIntoSearchBox(page: Page, query: string): Promise<boolean> {
    const candidates = [
      page.getByRole('combobox').first(),
      page.getByPlaceholder(/search/i).first(),
      page.locator('input[type="search"]').first(),
    ];
    for (const box of candidates) {
      try {
        if (!(await box.isVisible({ timeout: 3000 }))) continue;
        await box.click();
        await box.fill(query);
        return true;
      } catch {
        // Try the next selector.
      }
    }
    log.warn('Could not find the Ad Library search box');
    return false;
  }

  /** Fallback advertiser discovery: keyword search, then group ads by page. */
  private async advertisersViaKeywordSearch(
    page: Page,
    capture: NetworkCapture,
    query: string,
  ): Promise<AdvertiserPage[]> {
    const url =
      `${AD_LIBRARY_URL}?active_status=active&ad_type=all` +
      `&country=${encodeURIComponent(this.options.country)}` +
      `&q=${encodeURIComponent(query)}&search_type=keyword_unordered&media_type=all`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await sleep(4000);
    await page.mouse.wheel(0, 2000);
    await sleep(2000);

    const ads = extractAds(capture.drain(), this.options.country);
    const byPage = new Map<string, AdvertiserPage>();
    for (const ad of ads) {
      if (!ad.pageId || byPage.has(ad.pageId)) continue;
      byPage.set(ad.pageId, {
        pageId: ad.pageId,
        name: ad.advertiserName,
        category: null,
        likes: null,
        verification: null,
        imageUri: null,
        country: null,
      });
    }
    return [...byPage.values()];
  }
}

function rankMatch(advertiser: AdvertiserPage, query: string): number {
  const name = advertiser.name.toLowerCase();
  if (name === query) return 3;
  if (name.startsWith(query)) return 2;
  if (name.includes(query)) return 1;
  return 0;
}
