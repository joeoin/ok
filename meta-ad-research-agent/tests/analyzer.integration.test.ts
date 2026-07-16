import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLlmClient } from '../src/analyzer/llm-client.js';
import { AdAnalyzer } from '../src/analyzer/ad-analyzer.js';
import { generateCompanyReport } from '../src/reporting/report-generator.js';
import { groupCreatives } from '../src/analyzer/creative-grouper.js';
import { computeAggregates } from '../src/analyzer/aggregate.js';
import { extractAds } from '../src/parser/ad-parser.js';
import { legacyPayload } from './fixtures.js';

const ANALYSIS_JSON = {
  hook: 'Cut your energy bill by 40%',
  offer: 'Free quote',
  cta: 'Get Quote',
  customerPainPoint: 'High energy bills',
  desiredOutcome: 'Lower monthly costs',
  audience: 'Homeowners',
  funnelStage: 'conversion',
  emotionalTriggers: ['relief'],
  copywritingFramework: 'PAS',
  marketingAngle: 'cost savings',
  creativeStyle: 'product image',
  trustSignals: ['10,000 homeowners'],
  socialProof: 'Trusted by 10,000 homeowners',
  urgency: null,
  scarcity: null,
  objectionHandling: null,
  differentiators: [],
};

const REPORT_JSON = {
  executiveSummary: 'Savings-led strategy.',
  biggestStrategicInsight: 'bi', companyPositioning: 'cp', messagingStrategy: 'm',
  customerPsychology: 'psy', creativeWinners: 'cw', creativeBreakdown: 'cb',
  hookDistribution: 'hd', offerDistribution: 'od', funnelStrategy: 'f',
  competitiveWeaknesses: 'w', opportunities: 'o', counterStrategy: 'cs',
  actionItems: 'ai',
};

/** Minimal OpenAI-compatible /chat/completions mock. */
describe('AdAnalyzer with a mock OpenAI-compatible server', () => {
  let server: http.Server;
  let baseUrl: string;
  let requests = 0;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        requests++;
        const parsed = JSON.parse(body);
        const systemMsg = String(parsed.messages?.[0]?.content ?? '');
        const isReport = systemMsg.includes('executive briefing');
        const content = JSON.stringify(isReport ? REPORT_JSON : ANALYSIS_JSON);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content } }] }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}/v1`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('analyzes ads and generates the company report', async () => {
    const llm = createLlmClient({ provider: 'openai', apiKey: 'test', baseUrl, model: 'mock' });
    expect(llm).not.toBeNull();

    const ads = extractAds([legacyPayload], 'US');
    const analyzer = new AdAnalyzer(llm, 2);
    const analyzed = await analyzer.analyzeAll(ads);

    expect(analyzed).toHaveLength(1);
    expect(analyzed[0]!.analysisError).toBeNull();
    expect(analyzed[0]!.analysis).toMatchObject({
      hook: 'Cut your energy bill by 40%',
      funnelStage: 'conversion',
      emotionalTriggers: ['relief'],
    });

    const advertiser = {
      pageId: '111222333444', name: 'Acme Solar', category: null,
      likes: null, verification: null, imageUri: null, country: null,
    };
    const groups = groupCreatives(analyzed, { asOf: '2026-07-16' });
    const aggregates = computeAggregates(groups);
    const { report, error } = await generateCompanyReport(llm, advertiser, groups, aggregates, 3);
    expect(error).toBeNull();
    expect(report?.executiveSummary).toBe('Savings-led strategy.');
    expect(report?.counterStrategy).toBe('cs');
    expect(requests).toBeGreaterThanOrEqual(2);
  });

  it('returns null client for provider "none"', () => {
    expect(createLlmClient({ provider: 'none', apiKey: '', baseUrl: '', model: '' })).toBeNull();
  });
});
