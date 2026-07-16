import { describe, expect, it } from 'vitest';
import {
  creativeSignature,
  groupCreatives,
  rankCreativeGroups,
  summarizeCreatives,
} from '../src/analyzer/creative-grouper.js';
import type { AdRecord, AnalyzedAd } from '../src/types.js';

function ad(over: Partial<AdRecord>): AdRecord {
  return {
    adArchiveId: over.adArchiveId ?? '1',
    advertiserName: 'Solace',
    pageId: '110702245120634',
    status: over.status ?? 'active',
    platforms: over.platforms ?? ['facebook'],
    adText: over.adText ?? null,
    headline: over.headline ?? null,
    description: over.description ?? null,
    ctaText: over.ctaText ?? null,
    ctaType: null,
    landingPageUrl: over.landingPageUrl ?? null,
    displayFormat: null,
    creativeType: over.creativeType ?? 'image',
    assets: over.assets ?? [],
    startDate: over.startDate ?? null,
    endDate: over.endDate ?? null,
    searchCountry: over.searchCountry ?? 'US',
    languages: over.languages ?? ['en'],
    collationCount: null,
    adLibraryUrl: `https://www.facebook.com/ads/library/?id=${over.adArchiveId ?? '1'}`,
    screenshotPath: null,
  };
}
const analyzed = (a: AdRecord): AnalyzedAd => ({ ad: a, analysis: null, analysisError: null });

describe('creativeSignature', () => {
  it('is identical for ads with the same creative content', () => {
    const a = ad({ adArchiveId: '1', headline: 'Get Started Today', creativeType: 'image' });
    const b = ad({ adArchiveId: '2', headline: 'Get Started Today', creativeType: 'image' });
    expect(creativeSignature(a)).toBe(creativeSignature(b));
  });

  it('differs when the headline differs', () => {
    const a = ad({ adArchiveId: '1', headline: 'Lower Your Cost of Care' });
    const b = ad({ adArchiveId: '2', headline: 'Claim Denied by an Algorithm?' });
    expect(creativeSignature(a)).not.toBe(creativeSignature(b));
  });

  it('ignores CDN query-string noise on asset URLs', () => {
    const a = ad({ adArchiveId: '1', assets: [{ type: 'image', url: 'https://cdn/x/img.jpg?oh=aaa', previewUrl: null, localPath: null }] });
    const b = ad({ adArchiveId: '2', assets: [{ type: 'image', url: 'https://cdn/x/img.jpg?oh=zzz', previewUrl: null, localPath: null }] });
    expect(creativeSignature(a)).toBe(creativeSignature(b));
  });

  it('collapses ads that differ only by per-ad landing-URL tracking params', () => {
    // The Duolingo "100 ads → 100 creatives" cause: identical creative, unique
    // utm/fbclid on each delivery.
    const a = ad({ adArchiveId: '1', headline: 'Learn a language', landingPageUrl: 'https://duolingo.com/super?utm_source=fb&fbclid=AAA&ad_id=1' });
    const b = ad({ adArchiveId: '2', headline: 'Learn a language', landingPageUrl: 'https://duolingo.com/super?utm_source=ig&fbclid=BBB&ad_id=2' });
    const c = ad({ adArchiveId: '3', headline: 'Learn a language', landingPageUrl: 'https://duolingo.com/super/' });
    expect(creativeSignature(a)).toBe(creativeSignature(b));
    expect(creativeSignature(a)).toBe(creativeSignature(c)); // trailing slash normalized too
  });

  it('still separates genuinely different landing pages', () => {
    const a = ad({ adArchiveId: '1', headline: 'H', landingPageUrl: 'https://duolingo.com/super?utm=x' });
    const b = ad({ adArchiveId: '2', headline: 'H', landingPageUrl: 'https://duolingo.com/max?utm=x' });
    expect(creativeSignature(a)).not.toBe(creativeSignature(b));
  });

  it('collapses 100 tracking-param variants into 1 creative (the Duolingo bug)', () => {
    const ads = Array.from({ length: 100 }, (_, i) =>
      analyzed(ad({ adArchiveId: String(i), headline: 'Duolingo — Learn free', landingPageUrl: `https://duolingo.com/?utm_content=${i}&fbclid=x${i}` })),
    );
    const groups = groupCreatives(ads);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.duplicateCount).toBe(100);
  });
});

describe('groupCreatives', () => {
  it('collapses 8 identical ads into 1 creative (the hims pattern)', () => {
    const ads = Array.from({ length: 8 }, (_, i) =>
      analyzed(ad({ adArchiveId: String(i), headline: 'Get Started Today', creativeType: 'video' })),
    );
    const groups = groupCreatives(ads);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.duplicateCount).toBe(8);
    expect(groups[0]!.adArchiveIds).toHaveLength(8);
  });

  it('aggregates first/last seen, countries, languages, platforms', () => {
    const ads = [
      analyzed(ad({ adArchiveId: '1', headline: 'H', startDate: '2026-06-01', platforms: ['facebook'], languages: ['en'], searchCountry: 'US' })),
      analyzed(ad({ adArchiveId: '2', headline: 'H', startDate: '2026-06-10', platforms: ['instagram'], languages: ['es'], searchCountry: 'US' })),
    ];
    const [g] = groupCreatives(ads, { asOf: '2026-07-16' });
    expect(g!.firstSeen).toBe('2026-06-01');
    expect(g!.platforms.sort()).toEqual(['facebook', 'instagram']);
    expect(g!.languages.sort()).toEqual(['en', 'es']);
    expect(g!.countries).toEqual(['US']);
  });

  it('ages active creatives to the collection date for runtime', () => {
    const ads = [analyzed(ad({ adArchiveId: '1', headline: 'H', status: 'active', startDate: '2026-06-16' }))];
    const [g] = groupCreatives(ads, { asOf: '2026-07-16' });
    expect(g!.estimatedRuntimeDays).toBe(30);
  });

  it('leaves runtime null when dates are unknown', () => {
    const [g] = groupCreatives([analyzed(ad({ adArchiveId: '1', headline: 'H', startDate: null }))]);
    expect(g!.estimatedRuntimeDays).toBeNull();
  });

  it('picks the most complete ad as representative (same creative, extra metadata)', () => {
    // Same creative signature (headline/text/cta/url/type/assets identical);
    // "rich" only adds a captured screenshot + start date, which are NOT part
    // of the signature but do raise completeness.
    const thin = ad({ adArchiveId: 'thin', headline: 'H', startDate: null });
    const rich = { ...ad({ adArchiveId: 'rich', headline: 'H', startDate: '2026-06-01' }), screenshotPath: 'screenshots/x.png' };
    expect(creativeSignature(thin)).toBe(creativeSignature(rich));
    const groups = groupCreatives([analyzed(thin), analyzed(rich)]);
    expect(groups[0]!.duplicateCount).toBe(2);
    expect(groups[0]!.representative.adArchiveId).toBe('rich');
  });
});

describe('rankCreativeGroups', () => {
  it('ranks by duplication, then runtime, then coverage', () => {
    const many = analyzed(ad({ adArchiveId: 'a', headline: 'Many', startDate: '2026-07-10', status: 'active' }));
    const dupes = Array.from({ length: 5 }, (_, i) => analyzed(ad({ adArchiveId: 'a' + i, headline: 'Many', startDate: '2026-07-10', status: 'active' })));
    const oldLong = analyzed(ad({ adArchiveId: 'b', headline: 'OldLong', startDate: '2026-01-01', status: 'active' }));
    const groups = groupCreatives([...dupes, many, oldLong], { asOf: '2026-07-16' });
    expect(groups[0]!.headline).toBe('Many'); // 6 dupes beats 1
    expect(groups[0]!.duplicateCount).toBe(6);
  });
});

describe('summarizeCreatives', () => {
  it('produces the 678 -> 12 headline numbers', () => {
    const ads: AnalyzedAd[] = [];
    for (let c = 0; c < 12; c++) {
      const n = c === 0 ? 100 : 5; // one dominant creative
      for (let i = 0; i < n; i++) ads.push(analyzed(ad({ adArchiveId: `${c}-${i}`, headline: `Creative ${c}` })));
    }
    const summary = summarizeCreatives(groupCreatives(ads));
    expect(summary.uniqueCreatives).toBe(12);
    expect(summary.totalAds).toBe(100 + 11 * 5);
    expect(summary.topCreative!.headline).toBe('Creative 0');
    expect(summary.topCreative!.duplicateCount).toBe(100);
  });

  it('handles the empty case', () => {
    const s = summarizeCreatives([]);
    expect(s).toEqual({ totalAds: 0, uniqueCreatives: 0, duplicationRatio: 0, topCreative: null });
  });
});
