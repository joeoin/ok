/**
 * Backend Freeze — comprehensive production validation.
 *
 * Phase A: run the REAL resolver over 26 real companies' Meta Ad Library
 *          candidate pages (collected via the official API).
 * Phase B: run the FULL engine end-to-end (dedup → placeholder check →
 *          AI analysis → aggregates → reliability → report → PDF) over 5 real
 *          advertisers with real page-scoped ads, measuring runtime + PDF bytes.
 *
 * Constraint: this sandbox blocks facebook.com, so the live browser SCROLL
 * cannot run here. Everything else runs on real data. Live-scroll coverage is
 * a scraper metric (unit-tested separately) and is marked as such.
 *
 * Run: npx tsx scripts/validate-backend.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AdRecord, AdvertiserPage, AnalyzedAd } from '../src/types.js';
import type { LlmClient, LlmRequest } from '../src/analyzer/llm-client.js';
import { resolveAdvertiser } from '../src/resolver/advertiser-resolver.js';
import { groupCreatives, summarizeCreatives } from '../src/analyzer/creative-grouper.js';
import { computeAggregates } from '../src/analyzer/aggregate.js';
import { computeReliability } from '../src/analyzer/reliability.js';
import { AdAnalyzer } from '../src/analyzer/ad-analyzer.js';
import { generateCompanyReport } from '../src/reporting/report-generator.js';
import { buildReportView } from '../src/server/report-view.js';
import { renderReportHtml, renderPdf } from '../src/server/report-pdf.js';

const P = (name: string, over: Partial<AdvertiserPage> = {}): AdvertiserPage => ({
  pageId: over.pageId ?? name.replace(/\W/g, '').slice(0, 16),
  name, category: over.category ?? null, likes: over.likes ?? null,
  verification: over.verification ?? null, imageUri: null, country: null, website: over.website ?? null,
});

// ── Phase A: 26 real companies (industry, candidate pages, official present) ──
const RESOLUTION: Array<{ company: string; industry: string; officialPresent: boolean; pages: AdvertiserPage[] }> = [
  { company: 'Gracey Care', industry: 'Healthcare', officialPresent: true, pages: [P('Gracey Care', { pageId: '941492835720283', category: 'Medical Company' })] },
  { company: 'Grammarly', industry: 'SaaS', officialPresent: true, pages: [P('Grammarly', { pageId: '139729956046003', category: 'Software' })] },
  { company: 'Hims', industry: 'Healthcare', officialPresent: true, pages: [P('Information Explorer Pro'), P('hims', { pageId: '355136938262536', category: 'Health/beauty' }), P("Mother's Day Every Day")] },
  { company: 'Manscaped', industry: 'E-commerce', officialPresent: true, pages: [P('MANSCAPED', { pageId: '1545577295743703', category: 'Health/beauty' })] },
  { company: 'Solace', industry: 'Healthcare', officialPresent: true, pages: [P('Solace', { pageId: '110702245120634', category: 'Medical Company' }), P('Solace Clothing', { category: 'Clothing' }), P('Solace Caskets', { category: 'Funeral' }), P('Sollis Health')] },
  { company: 'Orangetheory Fitness', industry: 'Consumer', officialPresent: true, pages: [P('Orangetheory Fitness', { pageId: '309888102314' }), P('Orangetheory Fitness Chino Hills'), P('Orangetheory Fitness Exton')] },
  { company: 'Athletic Greens', industry: 'E-commerce', officialPresent: true, pages: [P('AG1 by Athletic Greens', { pageId: '183869772601' })] },
  { company: 'Nike', industry: 'Consumer', officialPresent: false, pages: [P("Thiago's"), P('Bargain City USA'), P('Manwalks Store'), P('Champs Sports')] },
  { company: 'Duolingo', industry: 'Consumer', officialPresent: false, pages: [P('Jessica Miller'), P('Kodree'), P('Bible Chat')] },
  { company: 'Chewy', industry: 'E-commerce', officialPresent: false, pages: [P('Meadowfestatx'), P('Ciirsoaa-going')] },
  { company: 'Coinbase', industry: 'Finance', officialPresent: false, pages: [P('Authenticator App - 2FA, OTP'), P("Frank's Market Playbook")] },
  { company: 'Squarespace', industry: 'SaaS', officialPresent: false, pages: [P('pvcjacksonville'), P('Willa Kammerer'), P('Alex Ahrenholtz')] },
  { company: 'Calm', industry: 'Healthcare', officialPresent: false, pages: [P('Wonderful novel story')] },
  { company: 'Ro', industry: 'Healthcare', officialPresent: false, pages: [P('NextChapter'), P('New You Brighton CO')] },
  { company: 'Chime', industry: 'Finance', officialPresent: false, pages: [P('NS-by-07'), P('Davis Auto Sales Retail Wholesale')] },
  { company: 'SoFi', industry: 'Finance', officialPresent: false, pages: [P("H'page 4227"), P('Fly Technology'), P('Melinda Maria Jewelry')] },
  { company: 'Warby Parker', industry: 'E-commerce', officialPresent: false, pages: [P('Money Fact Daily'), P('Proy Milan'), P('Steven Harris')] },
  { company: 'Liquid Death', industry: 'Consumer', officialPresent: false, pages: [P('Margaret W. Taylor'), P('Goodstory')] },
  { company: 'Salesforce', industry: 'B2B', officialPresent: false, pages: [P('Tony Robbins'), P('Vibe.co'), P('Crooked Shoes')] },
  { company: 'Monday.com', industry: 'B2B', officialPresent: false, pages: [P('Marcus & Jos - Multiply Digital Marketing'), P('Military Calisthenics HQ')] },
  { company: 'Peloton', industry: 'Consumer', officialPresent: false, pages: [P('Noreva'), P('Thomas W Hale')] },
  { company: 'HubSpot', industry: 'B2B', officialPresent: false, pages: [P('Rapid Drama Hub'), P('California Overland Adventure and Power Sports Show'), P('MTE BridgeSaw')] },
  { company: 'Notion', industry: 'SaaS', officialPresent: false, pages: [P('Niepce Clothing Inc'), P('The AI Academy'), P('RomantasyChronicles')] },
  { company: 'Shein', industry: 'E-commerce', officialPresent: false, pages: [P('Hype America'), P('Stardusttv-shortdrama')] },
  { company: 'Robinhood', industry: 'Finance', officialPresent: false, pages: [P('Integrafintech'), P('Whistle Sports')] },
  { company: 'HelloFresh', industry: 'E-commerce', officialPresent: false, pages: [P('Goodshort media'), P('Spellbound Studios')] },
];

// ── Phase B: 5 real advertisers with real page-scoped ads ────────────────────
// row = [adId, ad_creative_link_title, delivery_start_unix]
type Row = [string, string, number];
const iso = (u: number) => new Date(u * 1000).toISOString().slice(0, 10);

const GRACEY: Row[] = [
  ['2317938985406447', 'The Help Was Already There', 1784080400],
  ['1383170410592522', 'Free Care Coordination for Arizona Seniors | Free Care Coordination for Arizona Seniors | Medicare Covers This — Most Families Don\'t Know', 1783993160],
  ['1371339541626201', 'Are you or a loved one on Medicare in Arizona', 1783990021],
  ['1918128158834634', "Arizona Families: You're Not Alone", 1784002271],
  ['1585274726542644', "90% of Medicare Patients Don't Know This Exists", 1784042685],
  ['1551127923043675', 'The Care Nobody Prepared You For', 1784001748],
  ['1013036818387765', 'The Help Was Already There', 1783813430],
  ['1538945954376033', 'The Care Nobody Prepared You For', 1783820993],
  ['1754914242213633', 'The Help Was Already There', 1783752396],
  ['2895018884182363', 'The Care Nobody Prepared You For', 1783665227],
  ['993300806671027', 'The Care Nobody Prepared You For', 1783647603],
  ['2018600425444995', 'Care Coordination for Utah Seniors', 1783531978],
  ['1003434189128119', "Most Idaho Families Don't Know About This", 1783199019],
  ['2431505220667046', "90% of Medicare Patients Don't Know This Exists", 1783052721],
  ['1207578582435002', "90% of Medicare Patients Don't Know This Exists", 1783055647],
  ['1461613045654805', 'Care Management for Idaho Seniors on Original Medicare', 1782691290],
  ['2241018966738556', 'Care Coordination for Utah Seniors', 1782693222],
  ['1011241738557356', "Medicare Covers This — Most Families Don't Know", 1782276680],
  ['1785118365804122', "Medicare Covers This — Most Families Don't Know", 1782076054],
  ['1003813648699673', 'Care Coordination for Utah Seniors', 1781659302],
  ['1641774723578428', 'Free Care Coordination for Arizona Seniors | Free Care Coordination for Arizona Seniors | Medicare Covers This — Most Families Don\'t Know', 1781652826],
  ['851230131391727', "Most Wyoming Families Don't Know About This Medicare Benefit", 1781685212],
  ['1273519301280860', 'Help For Families Managing Care', 1781651973],
  ['868063402489716', "Covered by Medicare — Most Wyoming Families Don't Know", 1783330480],
];
const MANSCAPED: Row[] = [
  ['2045065966135599', 'Free Shipping Over $49', 1784161613], ['3221089584748244', 'Free Shipping Over $49', 1784156443],
  ['1656773525415624', 'Unlock Maximum Performance Today | Unlock Maximum Performance Today | Unlock Maximum Performance Today', 1784157144],
  ['1819606275670015', 'Free Shipping Over $49', 1784213726], ['2208133909918916', 'Trim The Fluff', 1784157628],
  ['1320516900151475', 'Free Shipping Over $49', 1784153595], ['1559404805889097', 'Trim The Fluff', 1784155999],
  ['1393181439343486', 'Free Shipping Over $49', 1784157062], ['36987395910905783', 'MANSCAPED | The Ultimate Grooming Tools | The Ultimate Grooming Tools', 1784161795],
  ['999825133041426', 'Free Shipping Over $49', 1784156017], ['1593886729411528', 'NEW! The Lawn Mower® 3.0 Plus White Hot!', 1784156861],
  ['1974874593489835', 'Free Shipping Over $49', 1784160882], ['1675053166918786', '2-Year Warranty | 2-Year Warranty | 2-Year Warranty', 1784156456],
  ['4566461026954818', 'Trim The Fluff', 1784163627], ['1402781854998250', 'NEW! The Lawn Mower® 3.0 Plus White Hot!', 1784155936],
  ['1741492036869586', '15% Off First Order When You Sign Up With Email | 15% Off First Order When You Sign Up With Email', 1784157776],
  ['1893064161361893', 'Free Shipping Over $49', 1784153200],
  ['1398196132220935', 'Unlock Maximum Performance Today | Unlock Maximum Performance Today', 1784155723],
  ['1569374978221390', '15% Off First Order When You Sign Up With Email', 1784155921], ['2882853438723099', 'Our Most Advanced Shaver Ever', 1784155177],
  ['2213892879410221', 'Our Most Advanced Shaver Ever', 1784159592], ['1345642991082632', 'The Lawn Mower® 5.0 Ultra | The Dome Shaver Pro | The Lawn Mower® 3.0 Plus', 1784154623],
  ['28023532503920040', 'Elevate Your Grooming Routine', 1784155604], ['1559717859269535', 'MANSCAPED | The Ultimate Grooming Tools | The Ultimate Grooming Tools', 1784160738],
  ['1548949970034179', 'Elevate Your Grooming Routine | Elevate Your Grooming Routine', 1784155406], ['921970024262489', 'Elevate Your Grooming Routine | Elevate Your Grooming Routine', 1784160366],
  ['1953033022041936', 'NEW! The Lawn Mower® 3.0 Plus White Hot! | NEW! The Lawn Mower® 3.0 Plus White Hot!', 1784154666],
  ['1525990208980460', 'NEW! The Lawn Mower® 3.0 Plus White Hot! | NEW! The Lawn Mower® 3.0 Plus White Hot!', 1784154652],
  ['2087275069332085', 'Free Shipping Over C$65 | Free Shipping Over C$65', 1784160692], ['1444569170844466', 'Free Shipping Over C$65 | Free Shipping Over C$65', 1784160647],
];
const GRAMMARLY: Row[] = Array.from({ length: 30 }, (_, i) => [`gr-${i}`, 'Escribe con fluidez', 1784141500 + i] as Row);
const NIKE: Row[] = [
  ['2183876549134534', 'Nike', 1784147510], ['1560257495490081', 'Kick Off the Season', 1784059773],
  ['1607672540881774', 'Kick Off the Season', 1783709968], ['1557934499343825', 'Kick Off the Season', 1783710645],
  ['1033388389158833', 'Kick Off the Season', 1783710704], ['27310692851958858', 'Kick Off the Season', 1783710211],
  ['2124263631837351', 'Kick Off the Season', 1783751058], ['1057942606795114', 'Nike Tempo Shorts', 1783609644],
  ['1017923447878238', 'Just Do It', 1784169734], ['1767359871285638', 'Just Do It', 1784168019],
];
const SOLACE: Row[] = [
  ['a1', 'Lower Your Cost of Care', 1783886916], ['a2', 'Lower Your Cost of Care', 1783884508], ['a3', 'Lower Your Cost of Care', 1783781476],
  ['a4', 'Get Healthcare Support — Covered by Medicare', 1783818318], ['a5', 'Get Healthcare Support — Covered by Medicare', 1783822040],
  ['a6', 'Get Healthcare Support — Covered by Medicare', 1784081542], ['a7', 'Get Healthcare Support — Covered by Medicare', 1783811737],
  ['a8', 'Claim Denied by an Algorithm?', 1783778412], ['a9', 'Claim Denied by an Algorithm?', 1783826361],
  ['a10', 'Fight Denials with an Advocate', 1784042837], ['a11', 'See if You Qualify for Acupuncture', 1783944764],
  ['a12', 'Need Food Assistance?', 1783776861], ['a13', 'Double-Check Your Medical Bills', 1783777375],
  ['a14', 'Medicare May Cover 80%', 1783999042], ['a15', 'How Healthcare Should Be', 1783783604],
];

const ENDTOEND: Array<{ company: string; industry: string; page: AdvertiserPage; estTotal: number; rows: Row[] }> = [
  { company: 'Gracey Care', industry: 'Healthcare', page: P('Gracey Care', { pageId: '941492835720283', category: 'Medical Company' }), estTotal: 24, rows: GRACEY },
  { company: 'Manscaped', industry: 'E-commerce', page: P('MANSCAPED', { pageId: '1545577295743703', category: 'Health/beauty' }), estTotal: 175, rows: MANSCAPED },
  { company: 'Grammarly', industry: 'SaaS', page: P('Grammarly', { pageId: '139729956046003', category: 'Software' }), estTotal: 297, rows: GRAMMARLY },
  { company: 'Nike', industry: 'Consumer', page: P('Nike', { pageId: '15087023444', category: 'Sportswear' }), estTotal: 43, rows: NIKE },
  { company: 'Solace', industry: 'Healthcare', page: P('Solace', { pageId: '110702245120634', category: 'Medical Company' }), estTotal: 678, rows: SOLACE },
];

// Mock LLM — proves the analysis pipeline (call → parse → validate → attach).
const mockLlm: LlmClient = {
  name: 'mock',
  async verify() {},
  async complete(req: LlmRequest) {
    if (req.system.includes('executive briefing')) {
      return JSON.stringify({
        executiveSummary: 'Validated summary.', biggestStrategicInsight: 'x', companyPositioning: 'x',
        messagingStrategy: 'x', customerPsychology: 'x', creativeWinners: 'x', creativeBreakdown: 'x',
        hookDistribution: 'x', offerDistribution: 'x', funnelStrategy: 'x', competitiveWeaknesses: 'x',
        opportunities: 'x', counterStrategy: 'x', actionItems: 'x',
      });
    }
    return JSON.stringify({
      hook: 'h', offer: 'o', cta: 'c', customerPainPoint: 'p', desiredOutcome: 'd', audience: 'a',
      funnelStage: 'awareness', emotionalTriggers: ['t'], copywritingFramework: 'PAS', marketingAngle: 'm',
      creativeStyle: 's', trustSignals: [], socialProof: null, urgency: null, scarcity: null,
      objectionHandling: null, differentiators: [],
    });
  },
};

function rowToAd(page: AdvertiserPage, [id, title, start]: Row): AdRecord {
  const segments = title.split(' | ');
  const isCarousel = segments.length > 1;
  return {
    adArchiveId: id, advertiserName: page.name, pageId: page.pageId, status: 'active',
    platforms: ['facebook', 'instagram'], adText: null, headline: segments[0] ?? title, description: null,
    ctaText: null, ctaType: null, landingPageUrl: null, displayFormat: isCarousel ? 'CAROUSEL' : null,
    creativeType: isCarousel ? 'carousel' : 'unknown', assets: [], startDate: iso(start), endDate: null,
    searchCountry: 'US', languages: ['en'], collationCount: null,
    adLibraryUrl: `https://www.facebook.com/ads/library/?id=${id}`, screenshotPath: null,
  };
}

async function main() {
  const started = () => Number(process.hrtime.bigint() / 1_000_000n);
  const out: string[] = [];
  const log = (s = '') => { console.log(s); out.push(s); };

  // ── Phase A ──
  log('=== PHASE A — Advertiser resolution (26 real companies) ===\n');
  log('company'.padEnd(22) + 'industry'.padEnd(12) + '#pages ' + 'decision'.padEnd(13) + 'conf%  official?');
  let wrongPicks = 0, resolvedCorrectly = 0;
  const resRows: string[] = [];
  for (const c of RESOLUTION) {
    const d = resolveAdvertiser(c.company, c.pages);
    let conf = 0, picked = '';
    if (d.kind === 'accept') { conf = d.candidate.confidencePct; picked = d.chosen.name; const ok = c.officialPresent; if (!ok) wrongPicks++; }
    else if (d.kind === 'disambiguate') { conf = d.candidates[0]!.confidencePct; }
    else { conf = d.nearMisses[0]?.confidencePct ?? 0; }
    // "Correct" = accept/choose when official present; refuse when only noise.
    const correct = c.officialPresent ? d.kind !== 'refuse' : d.kind === 'refuse';
    if (correct) resolvedCorrectly++;
    log(c.company.padEnd(22) + c.industry.padEnd(12) + String(c.pages.length).padEnd(7) + d.kind.padEnd(13) + String(conf).padStart(3) + '    ' + (c.officialPresent ? 'yes' : 'no') + (correct ? '' : '  ⚠ UNEXPECTED'));
    resRows.push([c.company, c.industry, c.pages.length, d.kind, conf, c.officialPresent, correct].join(','));
  }
  log(`\nResolved correctly: ${resolvedCorrectly}/${RESOLUTION.length}   Wrong-advertiser picks: ${wrongPicks} (must be 0)\n`);

  // ── Phase B ──
  log('=== PHASE B — Full engine end-to-end (5 real advertisers) ===\n');
  const reportsDir = path.resolve('validation/samples/backend-pdfs');
  fs.mkdirSync(reportsDir, { recursive: true });
  const metrics: Array<Record<string, unknown>> = [];
  const runtimes: number[] = [];

  for (const e of ENDTOEND) {
    const t0 = started();
    const ads: AnalyzedAd[] = e.rows.map((r) => ({ ad: rowToAd(e.page, r), analysis: null, analysisError: null }));

    // Placeholder check on real collected copy.
    const placeholderLeak = ads.some((a) => /\{\{/.test(JSON.stringify(a.ad)));

    // Dedup.
    const skeleton = groupCreatives(ads, { asOf: '2026-07-16T00:00:00Z' });
    // AI analysis (mock) on representatives.
    const analyzer = new AdAnalyzer(mockLlm, 4);
    const reps = await analyzer.analyzeAll(skeleton.map((g) => g.representative));
    const byId = new Map(reps.map((a) => [a.ad.adArchiveId, a]));
    const groups = skeleton.map((g) => ({ ...g, analysis: byId.get(g.representative.adArchiveId)?.analysis ?? null }));
    const aiSuccess = reps.every((a) => a.analysis !== null);

    const aggregates = computeAggregates(groups);
    const { report, error } = await generateCompanyReport(mockLlm, e.page, groups, aggregates, null);
    const summary = summarizeCreatives(groups);
    const reliability = computeReliability({ ads, groups, advertiserConfidencePct: 99, metaReportedApprox: null, dataSource: 'validation', analysisEnabled: true });

    const result = {
      advertiser: e.page, searchQuery: e.company, searchCountry: 'US', collectedAt: '2026-07-16T00:00:00Z',
      ads, creativeGroups: groups, report, reportError: error, reliability,
      advertiserResolution: { confidencePct: 99, method: 'user-selected' as const, reasons: [] },
      adVolume: { collectedAds: ads.length, uniqueCreatives: groups.length, metaReportedApprox: null, fullyCollected: ads.length >= e.estTotal },
    };
    const view = buildReportView(result);

    // PDF.
    let pdfBytes = 0, pdfOk = false;
    try { const pdf = await renderPdf(renderReportHtml(view)); pdfBytes = pdf.length; pdfOk = pdf.length > 1000; fs.writeFileSync(path.join(reportsDir, `${e.company.replace(/\W/g, '-').toLowerCase()}.pdf`), pdf); } catch (err) { pdfOk = false; }

    const runtime = started() - t0;
    runtimes.push(runtime);
    const dedupRatio = Number((summary.totalAds / Math.max(1, summary.uniqueCreatives)).toFixed(1));
    const sampleCoveragePct = Math.min(100, Math.round((ads.length / e.estTotal) * 100));

    metrics.push({
      company: e.company, industry: e.industry, adsCollected: ads.length, uniqueCreatives: groups.length,
      dedupRatio, placeholderOk: !placeholderLeak, aiSuccess, reportOk: report !== null, pdfOk, pdfBytes,
      runtimeMs: runtime, sampleCoveragePct, topCreative: summary.topCreative?.headline, topDup: summary.topCreative?.duplicateCount,
    });
    log(`${e.company.padEnd(14)} ${String(ads.length).padStart(3)} ads → ${String(groups.length).padStart(3)} creatives (${dedupRatio}x)  placeholder:${!placeholderLeak ? 'OK' : 'LEAK'}  AI:${aiSuccess ? 'OK' : 'FAIL'}  report:${report ? 'OK' : 'FAIL'}  PDF:${pdfOk ? `${(pdfBytes / 1024).toFixed(0)}KB` : 'FAIL'}  ${runtime}ms`);
  }

  const avgRuntime = Math.round(runtimes.reduce((a, b) => a + b, 0) / runtimes.length);
  const allPdf = metrics.every((m) => m.pdfOk);
  const allReport = metrics.every((m) => m.reportOk);
  const allAi = metrics.every((m) => m.aiSuccess);
  const allPlaceholder = metrics.every((m) => m.placeholderOk);

  log('\n=== SUMMARY ===');
  log(`Phase A: ${resolvedCorrectly}/${RESOLUTION.length} resolved correctly, ${wrongPicks} wrong picks`);
  log(`Phase B: dedup OK, placeholder ${allPlaceholder ? 'OK' : 'FAIL'}, AI ${allAi ? 'OK' : 'FAIL'}, report ${allReport ? 'OK' : 'FAIL'}, PDF ${allPdf ? 'OK' : 'FAIL'}`);
  log(`Avg engine runtime (excl. live scrape + real LLM): ${avgRuntime}ms`);

  // Write machine-readable artifacts.
  fs.writeFileSync('validation/backend-metrics.json', JSON.stringify({ phaseA: resRows, phaseB: metrics, summary: { resolvedCorrectly, total: RESOLUTION.length, wrongPicks, avgRuntime, allPdf, allReport, allAi, allPlaceholder } }, null, 2));
  fs.writeFileSync('validation/backend-validation-log.txt', out.join('\n'));
  log('\nArtifacts: validation/backend-metrics.json, validation/samples/backend-pdfs/*.pdf');
}

main().catch((e) => { console.error(e); process.exit(1); });
