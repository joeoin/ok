import { describe, expect, it } from 'vitest';
import { AD_ANALYSIS_SYSTEM_PROMPT } from '../src/prompts/ad-analysis-prompt.js';
import { COMPANY_REPORT_SYSTEM_PROMPT, buildCompanyReportUserPrompt } from '../src/prompts/company-report-prompt.js';
import { computeAggregates } from '../src/analyzer/aggregate.js';
import type { AdvertiserPage, CreativeGroup } from '../src/types.js';

/**
 * Version-locks the intelligence spec. If someone weakens the prompting back
 * toward generic "summarize the ads", these assertions fail. The redesign's
 * value lives in these directives.
 */
const REPORT = COMPANY_REPORT_SYSTEM_PROMPT;

describe('company report prompt encodes the intelligence method', () => {
  it('reasons from the conviction signal (duplication × runtime)', () => {
    expect(REPORT).toMatch(/DUPLICATION × RUNTIME/);
    expect(REPORT).toMatch(/CONVICTION MAP/);
  });
  it('requires the negative-space (what is NOT said) analysis', () => {
    expect(REPORT).toMatch(/NEGATIVE SPACE/);
    expect(REPORT.toLowerCase()).toMatch(/conspicuously does not/);
  });
  it('names psychological mechanisms, not moods', () => {
    expect(REPORT).toMatch(/loss aversion|authority|in-group|social proof/);
    expect(REPORT).toMatch(/PSYCHOLOGY DECODE/);
  });
  it('enforces evidence on every claim', () => {
    expect(REPORT).toMatch(/cites evidence|QUOTED line|cite evidence/i);
  });
  it('runs a self-critique / obviousness filter', () => {
    expect(REPORT).toMatch(/SELF-CRITIQUE/);
    expect(REPORT).toMatch(/60 seconds/);
  });
  it('bans filler, buzzwords, and generic advice', () => {
    expect(REPORT).toMatch(/BANNED/);
    expect(REPORT.toLowerCase()).toMatch(/buzzword/);
    expect(REPORT).toMatch(/synergy|holistic|best-in-class/);
  });
  it('shows a weak-vs-strong calibration', () => {
    expect(REPORT).toMatch(/WEAK/);
    expect(REPORT).toMatch(/STRONG/);
  });
  it('carries the persona stack and the paid-product framing', () => {
    expect(REPORT).toMatch(/McKinsey/);
    expect(REPORT).toMatch(/Meta ads strategist/i);
    expect(REPORT).toMatch(/behavioral scientist/i);
    expect(REPORT).toMatch(/copywriter/i);
  });
  it('demands the report answer the twelve strategic questions', () => {
    for (const q of ['trying to accomplish', 'psychology are they exploiting', 'objections', 'segments', 'NOT being said', 'beat them']) {
      expect(REPORT).toContain(q);
    }
  });
  it('still requests exactly the 14 report keys (schema-compatible)', () => {
    for (const k of ['executiveSummary', 'biggestStrategicInsight', 'companyPositioning', 'messagingStrategy', 'customerPsychology', 'creativeWinners', 'creativeBreakdown', 'hookDistribution', 'offerDistribution', 'funnelStrategy', 'competitiveWeaknesses', 'opportunities', 'counterStrategy', 'actionItems']) {
      expect(REPORT).toContain(`"${k}"`);
    }
  });
  it('keeps the "executive briefing" marker used to route report vs per-ad calls', () => {
    expect(REPORT).toMatch(/executive briefing/);
  });
});

describe('per-ad prompt demands specific, quoted signal', () => {
  it('requires quotes over paraphrase and named mechanisms', () => {
    expect(AD_ANALYSIS_SYSTEM_PROMPT).toMatch(/QUOTE, don't summarize/);
    expect(AD_ANALYSIS_SYSTEM_PROMPT).toMatch(/NAME the mechanism/);
    expect(AD_ANALYSIS_SYSTEM_PROMPT).toMatch(/Never "fear"\/"trust"/);
  });
});

describe('evidence digest is structured to provoke reasoning', () => {
  const page: AdvertiserPage = { pageId: '1', name: 'Acme', category: 'Health', likes: null, verification: null, imageUri: null, country: null, website: null };
  const group = (id: string, headline: string, dup: number, runtime: number): CreativeGroup => ({
    creativeId: id, duplicateCount: dup, adArchiveIds: [id], creativeType: 'image', headline,
    firstSeen: '2026-06-01', lastSeen: '2026-07-16', estimatedRuntimeDays: runtime, countries: ['US'], languages: ['en'], platforms: ['facebook'],
    representative: { adArchiveId: id, advertiserName: 'Acme', pageId: '1', status: 'active', platforms: ['facebook'], adText: 'body copy', headline, description: null, ctaText: 'Learn More', ctaType: null, landingPageUrl: 'https://acme.com', displayFormat: null, creativeType: 'image', assets: [], startDate: '2026-06-01', endDate: null, searchCountry: 'US', languages: ['en'], collationCount: null, adLibraryUrl: 'https://x', screenshotPath: null },
    analysis: null, analysisError: null,
  });
  const groups = [group('a', 'Low conviction', 1, 5), group('b', 'High conviction winner', 10, 40)];

  it('ranks creatives by conviction (duplication × runtime), not input order', () => {
    const prompt = buildCompanyReportUserPrompt(page, groups, computeAggregates(groups), 100);
    expect(prompt).toMatch(/CONVICTION|conviction=/);
    // The high-conviction creative must appear before the low one.
    expect(prompt.indexOf('High conviction winner')).toBeLessThan(prompt.indexOf('Low conviction'));
    expect(prompt).toMatch(/CONCENTRATION/);
    expect(prompt).toMatch(/TIME SPAN/);
  });
});
