import { describe, expect, it } from 'vitest';
import { renderMarkdownReport } from '../src/reporting/markdown-report.js';
import { extractAds } from '../src/parser/ad-parser.js';
import { legacyPayload } from './fixtures.js';
import type { ResearchResult } from '../src/types.js';

function makeResult(overrides: Partial<ResearchResult> = {}): ResearchResult {
  const [ad] = extractAds([legacyPayload], 'US');
  return {
    advertiser: {
      pageId: '111222333444',
      name: 'Acme Solar',
      category: 'Solar Energy Company',
      likes: 52340,
      verification: 'BLUE_VERIFIED',
      imageUri: null,
      country: 'US',
    },
    searchQuery: 'Acme Solar',
    searchCountry: 'US',
    collectedAt: '2026-07-16T00:00:00.000Z',
    ads: [{ ad: ad!, analysis: null, analysisError: 'Analysis disabled (LLM_PROVIDER=none)' }],
    report: null,
    reportError: 'Report generation disabled (LLM_PROVIDER=none)',
    ...overrides,
  };
}

describe('renderMarkdownReport', () => {
  it('renders overview, per-ad breakdown, and unavailability notes', () => {
    const md = renderMarkdownReport(makeResult());
    expect(md).toContain('# Meta Ad Library Research: Acme Solar');
    expect(md).toContain('| Ads collected | 1 (1 active) |');
    expect(md).toContain('Library ID**: [1234567890]');
    expect(md).toContain('_AI analysis unavailable_');
    expect(md).toContain('_Not generated_: Report generation disabled');
    // Constraint: never invent private metrics.
    expect(md).toContain('Spend, performance, and targeting data are not exposed');
  });

  it('renders report sections when a report exists', () => {
    const md = renderMarkdownReport(
      makeResult({
        report: {
          executiveSummary: 'Acme runs a savings-led strategy.',
          messagingStrategy: 'm',
          brandPositioning: 'b',
          primaryOffers: 'p',
          recurringHooks: 'r',
          creativeTrends: 'c',
          audienceStrategy: 'a',
          funnelStrategy: 'f',
          copywritingPatterns: 'cp',
          ctaAnalysis: 'cta',
          strengths: 's',
          weaknesses: 'w',
          potentialOpportunities: 'po',
          recommendations: 'rec',
        },
        reportError: null,
      }),
    );
    expect(md).toContain('## Executive Summary');
    expect(md).toContain('Acme runs a savings-led strategy.');
    expect(md).toContain('## Recommendations');
  });
});
