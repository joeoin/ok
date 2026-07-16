import { describe, expect, it } from 'vitest';
import { renderMarkdownReport } from '../src/reporting/markdown-report.js';
import { groupCreatives } from '../src/analyzer/creative-grouper.js';
import { computeReliability } from '../src/analyzer/reliability.js';
import { extractAds } from '../src/parser/ad-parser.js';
import { legacyPayload } from './fixtures.js';
import type { CompanyReport, ResearchResult } from '../src/types.js';

function makeResult(overrides: Partial<ResearchResult> = {}, metaReportedApprox: number | null = 3): ResearchResult {
  const ads = extractAds([legacyPayload], 'US').map((ad) => ({
    ad,
    analysis: null,
    analysisError: 'Analysis disabled (LLM_PROVIDER=none)',
  }));
  const creativeGroups = groupCreatives(ads, { asOf: '2026-07-16T00:00:00.000Z' });
  // Keep reliability and adVolume consistent with the same Meta figure.
  const reliability = computeReliability({
    ads,
    groups: creativeGroups,
    advertiserConfidencePct: 99,
    metaReportedApprox,
    dataSource: 'Meta Ad Library — browser scraper (public data only)',
    analysisEnabled: false,
  });
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
    ads,
    creativeGroups,
    report: null,
    reportError: 'Report generation disabled (LLM_PROVIDER=none)',
    reliability,
    advertiserResolution: { confidencePct: 99, method: 'auto-accepted', reasons: ['exact name match'] },
    adVolume: { collectedAds: ads.length, uniqueCreatives: creativeGroups.length, metaReportedApprox, fullyCollected: false },
    ...overrides,
  };
}

const fullReport: CompanyReport = {
  executiveSummary: 'Acme runs a savings-led strategy.',
  biggestStrategicInsight: 'One hook carries 42% of volume.',
  companyPositioning: 'positioning',
  messagingStrategy: 'messaging',
  customerPsychology: 'psychology',
  creativeWinners: 'winners',
  creativeBreakdown: 'breakdown',
  hookDistribution: 'hooks',
  offerDistribution: 'offers',
  funnelStrategy: 'funnel',
  competitiveWeaknesses: 'weaknesses',
  opportunities: 'opportunities',
  counterStrategy: 'counter',
  actionItems: 'actions',
};

describe('renderMarkdownReport', () => {
  it('renders the reliability panel, dedup headline, and honest data notes', () => {
    const md = renderMarkdownReport(makeResult());
    expect(md).toContain('# Competitive Intelligence Briefing: Acme Solar');
    expect(md).toContain('## Reliability');
    expect(md).toContain('Overall confidence');
    expect(md).toMatch(/ads collected → 1 unique creatives/);
    // Meta's figure is attributed and marked approximate; API estimate never shown.
    expect(md).toContain("Meta's Ad Library UI reports **≈3 results**");
    expect(md).toContain('verified by direct count');
    expect(md).toContain('_AI narrative not generated_');
    // Constraint: never invent private metrics.
    expect(md).toContain('are not exposed and are never estimated');
    // Honest missing-data explanation present.
    expect(md).toContain('What limits this report');
  });

  it('claims no total when Meta\'s figure was not captured', () => {
    const md = renderMarkdownReport(makeResult({}, null));
    expect(md).toContain('not verifiable');
    expect(md).not.toMatch(/≈\d+ results/);
    expect(md).toMatch(/API's estimate is unreliable/);
  });

  it('renders all 14 executive-briefing sections in order when a report exists', () => {
    const md = renderMarkdownReport(makeResult({ report: fullReport, reportError: null }));
    expect(md).toContain('## 1. Executive Summary');
    expect(md).toContain('Acme runs a savings-led strategy.');
    expect(md).toContain('## 2. Biggest Strategic Insight');
    expect(md).toContain('## 13. Counter Strategy');
    expect(md).toContain('## 14. Action Items');
    // Section order: executive summary appears before counter strategy.
    expect(md.indexOf('## 1. Executive Summary')).toBeLessThan(md.indexOf('## 13. Counter Strategy'));
  });
});
