/**
 * V1.0 verification harness: runs REAL Solace ads (collected via the official
 * Meta Ad Library API on 2026-07-16) through the new dedup + aggregate +
 * reliability + executive-briefing modules — proving the new pipeline path
 * end-to-end on real data. No LLM here, so the AI narrative is null; the
 * data-driven sections render fully. Run: npx tsx scripts/demo-solace-v1.ts
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AdRecord, AnalyzedAd, ResearchResult } from '../src/types.js';
import { groupCreatives } from '../src/analyzer/creative-grouper.js';
import { computeReliability } from '../src/analyzer/reliability.js';
import { renderMarkdownReport } from '../src/reporting/markdown-report.js';
import { creativeGroupToCsvRow, CSV_COLUMNS } from '../src/reporting/csv-exporter.js';
import { buildCsv } from '../src/utils/csv.js';
import { writeTextFile } from '../src/utils/fs.js';

// [adArchiveId, headline, deliveryStartUnix]
const SOLACE: Array<[string, string, number]> = [
  ['1522361232924034', 'Lower Your Cost of Care', 1783886916],
  ['1042782984867410', 'Lower Your Cost of Care', 1783884508],
  ['2105902190310315', 'Lower Your Cost of Care', 1783781476],
  ['2528041810967295', 'Lower Your Cost of Care', 1783781459],
  ['2070194016957304', 'Lower Your Cost of Care', 1783781366],
  ['1015408337963984', 'Lower Your Cost of Care', 1783780076],
  ['972380499136565', 'Lower Your Cost of Care', 1783781860],
  ['1601259411607108', 'Lower Your Cost of Care', 1783779556],
  ['1338459001814433', 'Medicare May Cover 80%', 1783999042],
  ['2117382465863283', 'Get Healthcare Support — Covered by Medicare', 1783818318],
  ['1541849033960608', 'Get Healthcare Support — Covered by Medicare', 1783822040],
  ['1042419258203744', 'Get Healthcare Support — Covered by Medicare', 1784081542],
  ['1042443308267704', 'Get Healthcare Support — Covered by Medicare', 1783811737],
  ['1439671431333498', 'Get Healthcare Support — Covered by Medicare', 1783964815],
  ['1548009253339480', 'Get Healthcare Support — Covered by Medicare', 1783877235],
  ['1033269162395137', 'Get Healthcare Support — Covered by Medicare', 1783813163],
  ['1651887382565632', 'Get Healthcare Support — Covered by Medicare', 1784049152],
  ['3666726326826546', 'Get Healthcare Support — Covered by Medicare', 1783887823],
  ['1775535633813990', 'Get Healthcare Support — Covered by Medicare', 1783786877],
  ['1460507925843417', 'Get Healthcare Support — Covered by Medicare', 1783796939],
  ['1661095018298682', 'Get Healthcare Support — Covered by Medicare', 1783873781],
  ['1021037167300148', 'Get Healthcare Support — Covered by Medicare', 1783920247],
  ['38019602320971793', 'Get Healthcare Support — Covered by Medicare', 1783954156],
  ['1068549118829333', 'Get Healthcare Support — Covered by Medicare', 1784067669],
  ['1854761082569511', 'Get Healthcare Support — Covered by Medicare', 1783926554],
  ['1410621690905536', 'Get Healthcare Support — Covered by Medicare', 1783876085],
  ['1039767571935077', 'Get Healthcare Support — Covered by Medicare', 1784033218],
  ['1511783023419565', 'Get Healthcare Support — Covered by Medicare', 1784046108],
  ['861440130068709', 'Get Healthcare Support — Covered by Medicare', 1783870475],
  ['1389922722989869', 'Get Healthcare Support — Covered by Medicare', 1784141833],
  ['3618008408363686', 'Get Healthcare Support — Covered by Medicare', 1783991385],
  ['1693019258640520', 'Get Healthcare Support — Covered by Medicare', 1783886509],
  ['1589680622765108', 'Talk to a Real Advocate Instead', 1783778104],
  ['3061194197412569', 'See if You Qualify for Acupuncture', 1783944764],
  ['1025438536742908', 'See if You Qualify for Acupuncture', 1783847434],
  ['1609626494016093', 'See if You Qualify for Acupuncture', 1783987259],
  ['1034658638934913', 'See if You Qualify for Acupuncture', 1783880163],
  ['3948408515455922', 'Fight Denials with an Advocate', 1784042837],
  ['1669265421866759', 'Fight Denials with an Advocate', 1784039777],
  ['1547015626872263', 'Fight Denials with an Advocate', 1783883029],
  ['1585083253175217', 'Medicare May Cover More Than You Think', 1784046580],
  ['1733409684455334', 'Claim Denied by an Algorithm?', 1783778412],
  ['2406873896818386', 'Claim Denied by an Algorithm?', 1783826361],
  ['1942002753159465', 'Claim Denied by an Algorithm?', 1783775046],
  ['1401092598499415', 'Claim Denied by an Algorithm?', 1783788560],
  ['1343456510568375', 'Claim Denied by an Algorithm?', 1783841800],
  ['2242925189790754', 'Claim Denied by an Algorithm?', 1783842769],
  ['1045482837953890', 'Need Food Assistance?', 1783776861],
  ['1035982088788710', 'Need Food Assistance?', 1783780431],
  ['1484139783465982', 'Need Food Assistance?', 1783778703],
  ['3024507611072217', 'Double-Check Your Medical Bills', 1783777375],
  ['1024197940419809', 'Double-Check Your Medical Bills', 1783781282],
  ['1795570821608046', 'Double-Check Your Medical Bills', 1783784266],
  ['2510700932686246', 'Healthcare Red Flags Adding Up?', 1783780191],
  ['2269382237212973', 'How Healthcare Should Be', 1783783604],
];

const iso = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

const ads: AnalyzedAd[] = SOLACE.map(([id, headline, started]) => {
  const ad: AdRecord = {
    adArchiveId: id,
    advertiserName: 'Solace',
    pageId: '110702245120634',
    status: 'active',
    platforms: ['facebook', 'instagram'],
    adText: null,
    headline,
    description: null,
    ctaText: null,
    ctaType: null,
    landingPageUrl: null,
    displayFormat: null,
    creativeType: 'unknown',
    assets: [],
    startDate: iso(started),
    endDate: null,
    searchCountry: 'US',
    languages: ['en'],
    collationCount: null,
    adLibraryUrl: `https://www.facebook.com/ads/library/?id=${id}`,
    screenshotPath: null,
  };
  return { ad, analysis: null, analysisError: 'AI analysis disabled in this demo run' };
});

const collectedAt = '2026-07-16T04:10:00.000Z';
const creativeGroups = groupCreatives(ads, { asOf: collectedAt });
const reliability = computeReliability({
  ads,
  groups: creativeGroups,
  advertiserConfidencePct: 99,
  estimatedPopulation: 678,
  dataSource: 'Official Meta Ad Library API (thin fields; body copy/CTA/media not exposed)',
  analysisEnabled: false,
});

const result: ResearchResult = {
  advertiser: { pageId: '110702245120634', name: 'Solace', category: 'Medical company', likes: null, verification: null, imageUri: null, country: 'US', website: 'solace.health' },
  searchQuery: 'Solace',
  searchCountry: 'US',
  collectedAt,
  ads,
  creativeGroups,
  report: null,
  reportError: 'AI narrative disabled in this verification run (no LLM key).',
  reliability,
  advertiserResolution: { confidencePct: 99, method: 'user-selected', reasons: ['exact name match', 'advertiser website matches', 'category matches expected industry'] },
  estimatedActiveAds: 678,
};

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(root, 'reports', 'solace', 'v1.0-demo');
const md = renderMarkdownReport(result);
const csv = buildCsv(CSV_COLUMNS, creativeGroups.map(creativeGroupToCsvRow));

await writeTextFile(path.join(outDir, 'report.md'), md);
await writeTextFile(path.join(root, 'exports', 'solace', 'v1.0-demo', 'creatives.csv'), csv);
await writeTextFile(path.join(root, 'exports', 'solace', 'v1.0-demo', 'research.json'), JSON.stringify(result, null, 2));

console.log(`ads=${ads.length} -> creatives=${creativeGroups.length}`);
console.log(`top creative: "${creativeGroups[0]!.headline}" x${creativeGroups[0]!.duplicateCount}`);
console.log(`reliability overall=${reliability.overall} completeness=${reliability.dataCompleteness} coverage=${reliability.coverage} creativeCoverage=${reliability.creativeCoverage}`);
console.log(`report -> ${path.join(outDir, 'report.md')}`);
