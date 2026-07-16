import path from 'node:path';
import type { AdRecord } from '../types.js';
import { ensureDir, slugify, writeBinaryFile } from '../utils/fs.js';
import { createLogger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

const log = createLogger('assets');

/**
 * Owns the on-disk layout for one research run:
 *
 *   <root>/screenshots/<advertiser>/<run>/<adId>.png
 *   <root>/downloads/<advertiser>/<run>/<adId>-<n>.<ext>
 *   <root>/exports/<advertiser>/<run>/…      (CSV + JSON)
 *   <root>/reports/<advertiser>/<run>/…      (Markdown)
 */
export class AssetStore {
  readonly advertiserSlug: string;

  constructor(
    private readonly rootDir: string,
    advertiserName: string,
    private readonly runId: string,
  ) {
    this.advertiserSlug = slugify(advertiserName);
  }

  dirFor(kind: 'screenshots' | 'downloads' | 'exports' | 'reports'): string {
    return path.join(this.rootDir, kind, this.advertiserSlug, this.runId);
  }

  /** Persist ad screenshots; mutates each ad's screenshotPath. */
  async saveScreenshots(ads: AdRecord[], shots: Map<string, Buffer>): Promise<void> {
    const dir = await ensureDir(this.dirFor('screenshots'));
    for (const ad of ads) {
      const buf = shots.get(ad.adArchiveId);
      if (!buf) continue;
      const filePath = path.join(dir, `${ad.adArchiveId}.png`);
      await writeBinaryFile(filePath, buf);
      ad.screenshotPath = path.relative(this.rootDir, filePath);
    }
  }

  /**
   * Download public creative images (and video thumbnails); mutates each
   * asset's localPath. Videos themselves are intentionally not downloaded by
   * default — they are large and the thumbnail is enough for analysis.
   */
  async downloadImages(ads: AdRecord[]): Promise<void> {
    const dir = await ensureDir(this.dirFor('downloads'));
    let saved = 0;
    for (const ad of ads) {
      let index = 0;
      for (const asset of ad.assets) {
        const url = asset.type === 'image' ? asset.url : asset.previewUrl;
        if (!url) continue;
        index++;
        try {
          const buffer = await withRetry(() => fetchBinary(url), { attempts: 3, baseDelayMs: 1000 });
          const ext = extensionFromUrl(url);
          const filePath = path.join(dir, `${ad.adArchiveId}-${index}${ext}`);
          await writeBinaryFile(filePath, buffer);
          asset.localPath = path.relative(this.rootDir, filePath);
          saved++;
        } catch (error) {
          log.debug(`Image download failed for ad ${ad.adArchiveId}: ${String(error)}`);
        }
      }
    }
    log.info(`Downloaded ${saved} creative image(s)`);
  }
}

async function fetchBinary(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url.slice(0, 120)}`);
  return Buffer.from(await response.arrayBuffer());
}

function extensionFromUrl(url: string): string {
  const match = new URL(url).pathname.match(/\.(jpe?g|png|gif|webp)$/i);
  return match ? match[0].toLowerCase() : '.jpg';
}
