import { describe, expect, it } from 'vitest';
import { extractAds, extractAdvertisers, findAdNodes } from '../src/parser/ad-parser.js';
import { graphqlPayload, legacyPayload, typeaheadPayload } from './fixtures.js';

describe('findAdNodes', () => {
  it('finds ad nodes in legacy payloads', () => {
    expect(findAdNodes(legacyPayload)).toHaveLength(1);
  });

  it('finds ad nodes in GraphQL payloads', () => {
    expect(findAdNodes(graphqlPayload)).toHaveLength(1);
  });

  it('ignores unrelated payloads', () => {
    expect(findAdNodes({ data: { viewer: { id: '123' } } })).toHaveLength(0);
  });
});

describe('extractAds', () => {
  it('normalizes the legacy camelCase shape', () => {
    const [ad] = extractAds([legacyPayload], 'US');
    expect(ad).toBeDefined();
    expect(ad!.adArchiveId).toBe('1234567890');
    expect(ad!.advertiserName).toBe('Acme Solar');
    expect(ad!.pageId).toBe('111222333444');
    expect(ad!.status).toBe('active');
    expect(ad!.platforms).toEqual(['facebook', 'instagram']);
    expect(ad!.adText).toBe('Cut your energy bill by 40%.\nFree quote today & save.');
    expect(ad!.headline).toBe('Go Solar, Save Big');
    expect(ad!.description).toBe('Trusted by 10,000 homeowners');
    expect(ad!.ctaText).toBe('Get Quote');
    expect(ad!.landingPageUrl).toBe('https://acmesolar.example/quote');
    expect(ad!.creativeType).toBe('image');
    expect(ad!.startDate).toBe('2025-06-15');
    expect(ad!.endDate).toBeNull();
    expect(ad!.collationCount).toBe(3);
    expect(ad!.assets).toHaveLength(1);
    expect(ad!.assets[0]!.url).toBe('https://cdn.example/img1.jpg');
    expect(ad!.adLibraryUrl).toContain('1234567890');
  });

  it('normalizes the GraphQL snake_case shape', () => {
    const [ad] = extractAds([graphqlPayload], 'ALL');
    expect(ad).toBeDefined();
    expect(ad!.adArchiveId).toBe('9876543210');
    expect(ad!.status).toBe('active');
    expect(ad!.adText).toBe('Winter special: free installation');
    expect(ad!.creativeType).toBe('video');
    expect(ad!.assets[0]).toMatchObject({
      type: 'video',
      url: 'https://cdn.example/vid.mp4',
      previewUrl: 'https://cdn.example/vid_thumb.jpg',
    });
  });

  it('dedupes ads across payloads by archive id', () => {
    const ads = extractAds([legacyPayload, legacyPayload, graphqlPayload], 'ALL');
    expect(ads).toHaveLength(2);
  });

  it('marks unknown status when isActive is missing', () => {
    const payload = JSON.parse(JSON.stringify(legacyPayload));
    delete payload.payload.results[0][0].isActive;
    const [ad] = extractAds([payload], 'ALL');
    expect(ad!.status).toBe('unknown');
  });
});

describe('extractAdvertisers', () => {
  it('extracts advertiser pages from typeahead payloads', () => {
    const pages = extractAdvertisers([typeaheadPayload]);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({
      pageId: '111222333444',
      name: 'Acme Solar',
      category: 'Solar Energy Company',
      likes: 52340,
      verification: 'BLUE_VERIFIED',
      country: 'US',
    });
  });

  it('does not treat ad nodes as advertisers', () => {
    const pages = extractAdvertisers([legacyPayload]);
    // The legacy ad node contains pageID+pageName but no page-suggestion signals.
    expect(pages.every((p) => p.pageId !== '1234567890')).toBe(true);
  });
});
