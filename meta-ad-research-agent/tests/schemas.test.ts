import { describe, expect, it } from 'vitest';
import { adAnalysisSchema, companyReportSchema, extractJsonObject } from '../src/analyzer/schemas.js';

describe('extractJsonObject', () => {
  it('parses bare JSON', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses JSON inside a code fence', () => {
    expect(extractJsonObject('Here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('parses JSON surrounded by prose', () => {
    expect(extractJsonObject('Sure! {"a":{"b":2}} Hope that helps.')).toEqual({ a: { b: 2 } });
  });

  it('throws when no JSON object exists', () => {
    expect(() => extractJsonObject('no json here')).toThrow();
  });
});

describe('adAnalysisSchema', () => {
  it('coerces "N/A"-style strings to null and comma strings to arrays', () => {
    const parsed = adAnalysisSchema.parse({
      hook: 'Bold claim about savings',
      offer: 'N/A',
      cta: '',
      customerPainPoint: 'high bills',
      desiredOutcome: null,
      audience: 'homeowners',
      funnelStage: 'Conversion stage',
      emotionalTriggers: 'fear, hope',
      copywritingFramework: 'PAS',
      marketingAngle: 'price',
      creativeStyle: 'UGC',
      trustSignals: null,
      socialProof: 'not available',
      urgency: null,
      scarcity: null,
      objectionHandling: null,
      differentiators: ['patented tech'],
    });
    expect(parsed.offer).toBeNull();
    expect(parsed.cta).toBeNull();
    expect(parsed.socialProof).toBeNull();
    expect(parsed.funnelStage).toBe('conversion');
    expect(parsed.emotionalTriggers).toEqual(['fear', 'hope']);
    expect(parsed.trustSignals).toEqual([]);
  });

  it('tolerates entirely missing keys', () => {
    const parsed = adAnalysisSchema.parse({});
    expect(parsed.hook).toBeNull();
    expect(parsed.emotionalTriggers).toEqual([]);
    expect(parsed.funnelStage).toBeNull();
  });
});

describe('companyReportSchema', () => {
  it('fills missing sections with "Not Available"', () => {
    const parsed = companyReportSchema.parse({ executiveSummary: 'Summary here' });
    expect(parsed.executiveSummary).toBe('Summary here');
    expect(parsed.competitiveWeaknesses).toBe('Not Available');
    expect(parsed.counterStrategy).toBe('Not Available');
  });
});
