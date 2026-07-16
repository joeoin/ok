import { describe, expect, it } from 'vitest';
import { computeReliability } from '../src/analyzer/reliability.js';
import { groupCreatives } from '../src/analyzer/creative-grouper.js';
import type { AdRecord, AnalyzedAd } from '../src/types.js';

function ad(over: Partial<AdRecord>): AdRecord {
  return {
    adArchiveId: over.adArchiveId ?? '1',
    advertiserName: 'Solace',
    pageId: 'p',
    status: 'active',
    platforms: over.platforms ?? [],
    adText: over.adText ?? null,
    headline: over.headline ?? null,
    description: over.description ?? null,
    ctaText: over.ctaText ?? null,
    ctaType: null,
    landingPageUrl: over.landingPageUrl ?? null,
    displayFormat: null,
    creativeType: 'image',
    assets: over.assets ?? [],
    startDate: over.startDate ?? null,
    endDate: null,
    searchCountry: 'US',
    languages: [],
    collationCount: null,
    adLibraryUrl: 'https://x',
    screenshotPath: over.screenshotPath ?? null,
  };
}
const analyzed = (a: AdRecord, withAnalysis = false): AnalyzedAd => ({
  ad: a,
  analysis: withAnalysis ? ({} as never) : null,
  analysisError: null,
});

describe('computeReliability', () => {
  it('scores a thin API-only run low and explains why', () => {
    const ads = [analyzed(ad({ adArchiveId: '1', headline: 'H' }))]; // headline only
    const groups = groupCreatives(ads);
    const r = computeReliability({
      ads,
      groups,
      advertiserConfidencePct: 99,
      estimatedPopulation: 678,
      dataSource: 'Official Meta Ad Library API (thin fields)',
      analysisEnabled: false,
    });
    expect(r.dataCompleteness).toBeLessThan(30);
    expect(r.coverage).toBeLessThan(5); // 1 of 678
    expect(r.missingDataExplanations.join(' ')).toMatch(/primary text|CTA|landing page/);
    expect(r.missingDataExplanations.join(' ')).toMatch(/coverage|active ads/i);
    expect(r.missingDataExplanations.join(' ')).toMatch(/AI analysis was disabled/);
    expect(r.dataSource).toMatch(/API/);
  });

  it('scores a rich, fully-covered run high', () => {
    const ads = Array.from({ length: 10 }, (_, i) =>
      analyzed(
        ad({
          adArchiveId: String(i),
          headline: 'H' + i,
          adText: 'body',
          description: 'd',
          ctaText: 'Shop Now',
          landingPageUrl: 'https://x',
          platforms: ['facebook', 'instagram'],
          startDate: '2026-06-01',
          assets: [{ type: 'image', url: 'https://cdn/i.jpg', previewUrl: null, localPath: 'downloads/i.jpg' }],
          screenshotPath: 'screenshots/i.png',
        }),
        true,
      ),
    );
    const groups = groupCreatives(ads);
    const r = computeReliability({
      ads,
      groups,
      advertiserConfidencePct: 100,
      estimatedPopulation: 10,
      dataSource: 'Scraper (full creative)',
      analysisEnabled: true,
    });
    expect(r.overall).toBeGreaterThan(90);
    expect(r.dataCompleteness).toBe(100);
    expect(r.coverage).toBe(100);
    expect(r.creativeCoverage).toBe(100);
  });

  it('drops overall when the advertiser confidence is low', () => {
    const ads = [analyzed(ad({ adArchiveId: '1', headline: 'H', adText: 'b', ctaText: 'x', landingPageUrl: 'y', platforms: ['facebook'], startDate: '2026-06-01', assets: [{ type: 'image', url: 'u', previewUrl: null, localPath: null }] }))];
    const groups = groupCreatives(ads);
    const low = computeReliability({ ads, groups, advertiserConfidencePct: 72, estimatedPopulation: 1, dataSource: 's', analysisEnabled: true });
    const high = computeReliability({ ads, groups, advertiserConfidencePct: 100, estimatedPopulation: 1, dataSource: 's', analysisEnabled: true });
    expect(high.overall).toBeGreaterThan(low.overall);
  });

  it('reports coverage as not-measurable when population is unknown', () => {
    const ads = [analyzed(ad({ adArchiveId: '1', headline: 'H' }))];
    const groups = groupCreatives(ads);
    const r = computeReliability({ ads, groups, advertiserConfidencePct: 100, estimatedPopulation: null, dataSource: 's', analysisEnabled: false });
    expect(r.missingDataExplanations.join(' ')).toMatch(/population size is not exposed/);
  });
});
