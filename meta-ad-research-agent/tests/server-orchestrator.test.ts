import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { searchAdvertiser, analyzeDemo, candidatesFor } from '../src/server/orchestrator.js';
import { ReportStore } from '../src/server/store.js';
import { buildReportView } from '../src/server/report-view.js';

describe('searchAdvertiser — the three resolution flows (demo pages)', () => {
  it('auto-accepts Nike and surfaces low-confidence alternatives', () => {
    const r = searchAdvertiser('nike', candidatesFor('nike', 'demo'), 'demo');
    expect(r.outcome).toBe('auto');
    expect(r.chosenPageId).toBe('15087023444');
    const top = r.candidates[0]!;
    expect(top.name).toBe('Nike');
    expect(top.confidencePct).toBeGreaterThan(95);
    expect(r.candidates.slice(1).every((c) => c.confidencePct < 40)).toBe(true);
  });

  it('asks the user to choose between real "Solace" companies', () => {
    const r = searchAdvertiser('solace', candidatesFor('solace', 'demo'), 'demo');
    expect(r.outcome).toBe('choose');
    expect(r.candidates.map((c) => c.name)).toContain('Solace Clothing');
    expect(r.candidates[0]!.name).toBe('Solace');
  });

  it('refuses HubSpot (only impersonators / coincidental matches)', () => {
    const r = searchAdvertiser('hubspot', candidatesFor('hubspot', 'demo'), 'demo');
    expect(r.outcome).toBe('refuse');
    expect(r.message).toMatch(/confidently matches/i);
  });
});

describe('analyzeDemo — staged pipeline + save/view round-trip', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'adintel-store-'));
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('emits every stage, dedups, and produces a saveable report', async () => {
    const stages: string[] = [];
    const page = candidatesFor('solace', 'demo').find((p) => p.pageId === '110702245120634')!;
    const result = await analyzeDemo(
      {
        query: 'solace',
        pageId: '110702245120634',
        page,
        resolutionConfidencePct: 100,
        resolutionMethod: 'user-selected',
        resolutionReasons: ['exact name match'],
      },
      (stage, status) => stages.push(`${stage}:${status}`),
    );

    for (const s of ['resolving', 'collecting', 'deduplicating', 'analyzing', 'reporting', 'done']) {
      expect(stages.some((x) => x.startsWith(s))).toBe(true);
    }
    // Dedup: 55 real ads collapse to 12 creatives; count is never the API estimate.
    expect(result.adVolume.collectedAds).toBe(55);
    expect(result.adVolume.uniqueCreatives).toBe(12);
    expect(result.adVolume.metaReportedApprox).toBe(370);
    expect(result.report?.executiveSummary).toMatch(/direct-response/i);

    const store = new ReportStore(dir);
    const meta = await store.save('solace-test', result);
    expect(meta.uniqueCreatives).toBe(12);

    const loaded = await store.get('solace-test');
    expect(loaded).not.toBeNull();
    const view = buildReportView(loaded!.result);
    expect(view.advertiser.name).toBe('Solace');
    expect(view.winners[0]!.headline).toBe('Get Healthcare Support — Covered by Medicare');
    expect(view.winners[0]!.duplicateCount).toBe(23);
    // Never fabricates a total: view carries Meta's figure, not the API estimate.
    expect(view.headline.metaReportedApprox).toBe(370);
  });

  it('rejects path-traversal ids in the store', async () => {
    const store = new ReportStore(dir);
    expect(await store.get('../etc/passwd')).toBeNull();
  });
});
