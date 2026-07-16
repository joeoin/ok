import fs from 'node:fs/promises';
import path from 'node:path';
import type { ResearchResult } from '../types.js';

/**
 * Saved-reports store (Screen 6). One JSON file per report on disk — no
 * database, keeping V1 minimal. Reports are the durable product artifact.
 */
export interface SavedReportMeta {
  id: string;
  advertiserName: string;
  query: string;
  createdAt: string;
  overall: number;
  collectedAds: number;
  uniqueCreatives: number;
}

export interface SavedReport extends SavedReportMeta {
  result: ResearchResult;
}

export class ReportStore {
  constructor(private readonly dir: string) {}

  private file(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  async save(id: string, result: ResearchResult): Promise<SavedReportMeta> {
    await fs.mkdir(this.dir, { recursive: true });
    const meta: SavedReportMeta = {
      id,
      advertiserName: result.advertiser.name,
      query: result.searchQuery,
      createdAt: result.collectedAt,
      overall: result.reliability.overall,
      collectedAds: result.adVolume.collectedAds,
      uniqueCreatives: result.adVolume.uniqueCreatives,
    };
    const payload: SavedReport = { ...meta, result };
    await fs.writeFile(this.file(id), JSON.stringify(payload, null, 2), 'utf8');
    return meta;
  }

  async get(id: string): Promise<SavedReport | null> {
    try {
      if (!/^[a-z0-9-]+$/i.test(id)) return null; // guard against path traversal
      return JSON.parse(await fs.readFile(this.file(id), 'utf8')) as SavedReport;
    } catch {
      return null;
    }
  }

  async list(): Promise<SavedReportMeta[]> {
    let files: string[] = [];
    try {
      files = (await fs.readdir(this.dir)).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
    const metas: SavedReportMeta[] = [];
    for (const f of files) {
      try {
        const raw = JSON.parse(await fs.readFile(path.join(this.dir, f), 'utf8')) as SavedReport;
        metas.push({
          id: raw.id,
          advertiserName: raw.advertiserName,
          query: raw.query,
          createdAt: raw.createdAt,
          overall: raw.overall,
          collectedAds: raw.collectedAds,
          uniqueCreatives: raw.uniqueCreatives,
        });
      } catch {
        // Skip unreadable files.
      }
    }
    return metas.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
}
