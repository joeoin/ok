import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeName } from './advertiser-resolver.js';

/** A previously confirmed advertiser resolution. */
export interface CachedResolution {
  pageId: string;
  name: string;
  /** ISO timestamp the mapping was confirmed. */
  confirmedAt: string;
}

/**
 * Historical advertiser cache. Once a query has been confidently resolved (or
 * confirmed by a user), remember it so future runs are instant and stable —
 * and so a brand that keyword-search can't surface is still found.
 */
export interface AdvertiserCache {
  get(query: string): CachedResolution | undefined;
  remember(query: string, resolution: Omit<CachedResolution, 'confirmedAt'>, at: string): void;
}

/** In-memory cache. Deterministic; the unit under test. */
export class InMemoryAdvertiserCache implements AdvertiserCache {
  private readonly map = new Map<string, CachedResolution>();

  constructor(seed: Record<string, CachedResolution> = {}) {
    for (const [query, res] of Object.entries(seed)) this.map.set(normalizeName(query), res);
  }

  get(query: string): CachedResolution | undefined {
    return this.map.get(normalizeName(query));
  }

  remember(query: string, resolution: Omit<CachedResolution, 'confirmedAt'>, at: string): void {
    this.map.set(normalizeName(query), { ...resolution, confirmedAt: at });
  }

  entries(): Record<string, CachedResolution> {
    return Object.fromEntries(this.map.entries());
  }
}

/**
 * JSON-file-backed cache. Load once at startup, persist after a run. Kept
 * separate from the in-memory logic so the core stays trivially testable.
 */
export class JsonFileAdvertiserCache extends InMemoryAdvertiserCache {
  constructor(private readonly filePath: string, seed: Record<string, CachedResolution> = {}) {
    super(seed);
  }

  static async load(filePath: string): Promise<JsonFileAdvertiserCache> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const seed = JSON.parse(raw) as Record<string, CachedResolution>;
      return new JsonFileAdvertiserCache(filePath, seed);
    } catch {
      return new JsonFileAdvertiserCache(filePath, {});
    }
  }

  async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.entries(), null, 2), 'utf8');
  }
}
