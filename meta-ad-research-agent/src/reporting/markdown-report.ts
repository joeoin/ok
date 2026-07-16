import path from 'node:path';
import type { CompanyReport, CreativeGroup, ResearchResult } from '../types.js';
import type { AssetStore } from '../storage/asset-store.js';
import { computeAggregates, type Distribution } from '../analyzer/aggregate.js';
import { summarizeCreatives } from '../analyzer/creative-grouper.js';
import { writeTextFile } from '../utils/fs.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('markdown');

const NA = '_Not Available_';
const show = (v: string | null | undefined): string => (v && v.trim() !== '' ? v : NA);
const showList = (v: string[] | undefined): string => (v && v.length ? v.join(', ') : NA);

/** Render the executive briefing as Markdown. Returns the file path. */
export async function writeMarkdownReport(store: AssetStore, result: ResearchResult): Promise<string> {
  const filePath = path.join(store.dirFor('reports'), 'report.md');
  await writeTextFile(filePath, renderMarkdownReport(result));
  log.info(`Wrote Markdown report: ${filePath}`);
  return filePath;
}

export function renderMarkdownReport(result: ResearchResult): string {
  const { advertiser, creativeGroups, report, reliability, adVolume } = result;
  const summary = summarizeCreatives(creativeGroups);
  const agg = computeAggregates(creativeGroups);

  const lines: string[] = [
    `# Competitive Intelligence Briefing: ${advertiser.name}`,
    '',
    `> Generated ${result.collectedAt} · Query "${result.searchQuery}" · Country scope: ${result.searchCountry}`,
    '> Source: Meta Ad Library (public data only). Spend, reach, CTR, conversions, and audience targeting are not exposed and are never estimated.',
    '',
    ...reliabilityPanel(result),
    '',
    ...dedupHeadline(summary.totalAds, summary.uniqueCreatives, summary.topCreative, adVolume),
    '',
  ];

  // The 14-section executive briefing, in order.
  if (report) {
    lines.push(
      ...section('1. Executive Summary', report.executiveSummary),
      ...section('2. Biggest Strategic Insight', report.biggestStrategicInsight),
      ...section('3. Company Positioning', report.companyPositioning),
      ...section('4. Messaging Strategy', report.messagingStrategy),
      ...section('5. Customer Psychology', report.customerPsychology),
      ...section('6. Creative Winners', report.creativeWinners),
      ...creativeWinnersTable(creativeGroups),
      ...section('7. Creative Breakdown', report.creativeBreakdown),
      ...distributionSection('8. Hook Distribution', report.hookDistribution, agg.hooks),
      ...distributionSection('9. Offer Distribution', report.offerDistribution, agg.offers),
      ...distributionSection('10. Funnel Strategy', report.funnelStrategy, agg.funnelStages),
      ...section('11. Competitive Weaknesses', report.competitiveWeaknesses),
      ...section('12. Opportunities', report.opportunities),
      ...section('13. Counter Strategy', report.counterStrategy),
      ...section('14. Action Items', report.actionItems),
    );
  } else {
    // No AI report: still deliver the data-driven briefing.
    lines.push(
      '## Company-Wide Analysis',
      '',
      `_AI narrative not generated_: ${result.reportError ?? 'unknown reason'}. The data-driven sections below are still complete.`,
      '',
      ...creativeWinnersTable(creativeGroups),
      ...distributionSection('Hook Distribution', null, agg.hooks),
      ...distributionSection('Offer Distribution', null, agg.offers),
      ...distributionSection('Funnel Strategy', null, agg.funnelStages),
      ...distributionSection('Format Mix', null, agg.formats),
    );
  }

  lines.push('## Appendix — Creative-by-Creative Breakdown', '');
  creativeGroups.forEach((g, i) => lines.push(...renderCreative(g, i + 1)));

  return lines.join('\n');
}

function reliabilityPanel(result: ResearchResult): string[] {
  const r = result.reliability;
  const res = result.advertiserResolution;
  const bar = (n: number) => `${n}/100`;
  const lines = [
    '## Reliability',
    '',
    '| Signal | Score |',
    '| --- | --- |',
    `| **Overall confidence** | **${bar(r.overall)}** |`,
    `| Advertiser confidence | ${bar(r.advertiserConfidence)} (${res.method}) |`,
    `| Data completeness | ${bar(r.dataCompleteness)} |`,
    `| Coverage | ${r.coverageMeasured ? bar(r.coverage) : 'Not measured'} |`,
    `| Creative coverage | ${bar(r.creativeCoverage)} |`,
    `| Data source | ${r.dataSource} |`,
    '',
  ];
  if (r.missingDataExplanations.length) {
    lines.push('**What limits this report:**', '');
    for (const e of r.missingDataExplanations) lines.push(`- ${e}`);
    lines.push('');
  }
  return lines;
}

function dedupHeadline(
  totalAds: number,
  unique: number,
  top: CreativeGroup | null,
  adVolume: ResearchResult['adVolume'],
): string[] {
  const lines = [
    '## At a Glance',
    '',
    `**${totalAds} ads collected → ${unique} unique creatives.** (Both counts verified by direct count of what was collected.)`,
  ];
  // Meta's own approximate figure — shown only when actually read from the UI,
  // always attributed and marked approximate. The API's estimated_total_count
  // is never displayed.
  if (adVolume.metaReportedApprox !== null) {
    const note = adVolume.fullyCollected
      ? 'the full set was collected'
      : `${totalAds} of them collected here`;
    lines.push(
      '',
      `Meta's Ad Library UI reports **≈${adVolume.metaReportedApprox} results** for this page ` +
        `(Meta's own approximate figure; ${note}).`,
    );
  } else {
    lines.push(
      '',
      "_Total active-ad count: not verifiable._ Meta's UI figure wasn't captured this run, and the Ad Library API's estimate is unreliable, so no total is claimed — only the counts above, which we verified directly.",
    );
  }
  if (top) {
    lines.push(
      '',
      `**Top creative:** "${show(top.headline)}" — ${top.duplicateCount} duplicate ads` +
        (top.estimatedRuntimeDays !== null ? `, ~${top.estimatedRuntimeDays} days running` : '') +
        `. Duplication + longevity make this the advertiser's most-backed message.`,
    );
  }
  return lines;
}

function section(title: string, body: string): string[] {
  return [`## ${title}`, '', (body ?? '').trim() || NA, ''];
}

function distributionSection(title: string, body: string | null, dist: Distribution[]): string[] {
  const lines = [`## ${title}`, ''];
  if (body) lines.push(body.trim() || NA, '');
  if (dist.length) {
    lines.push('| Item | Ads | Creatives | Share |', '| --- | --- | --- | --- |');
    for (const d of dist.slice(0, 12)) lines.push(`| ${d.label} | ${d.ads} | ${d.creatives} | ${d.adSharePct}% |`);
    lines.push('');
  } else {
    lines.push('_Not determinable from public data._', '');
  }
  return lines;
}

function creativeWinnersTable(groups: CreativeGroup[]): string[] {
  if (groups.length === 0) return [];
  const lines = [
    '| # | Creative | Ads | Runtime | Type |',
    '| --- | --- | --- | --- | --- |',
  ];
  groups.slice(0, 10).forEach((g, i) => {
    const rt = g.estimatedRuntimeDays !== null ? `${g.estimatedRuntimeDays}d` : '?';
    lines.push(`| ${i + 1} | ${truncate(show(g.headline), 60)} | ${g.duplicateCount} | ${rt} | ${g.creativeType} |`);
  });
  lines.push('');
  return lines;
}

function renderCreative(g: CreativeGroup, n: number): string[] {
  const rep = g.representative;
  const title = g.headline ?? (rep.adText ? rep.adText.slice(0, 60).replace(/\s+/g, ' ') + '…' : g.creativeId);
  const lines = [
    `### ${n}. ${title}`,
    '',
    `- **Creative ID**: ${g.creativeId} · **${g.duplicateCount} duplicate ad(s)**`,
    `- **Type**: ${g.creativeType} · **Platforms**: ${showList(g.platforms)} · **Runtime**: ${g.estimatedRuntimeDays !== null ? g.estimatedRuntimeDays + ' days' : NA}`,
    `- **First seen**: ${show(g.firstSeen)} · **Last seen**: ${show(g.lastSeen)}`,
    `- **Countries**: ${showList(g.countries)} · **Languages**: ${showList(g.languages)}`,
    `- **Example ad**: [${rep.adArchiveId}](${rep.adLibraryUrl})`,
  ];
  if (rep.screenshotPath) lines.push(`- **Screenshot**: \`${rep.screenshotPath}\``);
  if (rep.adText) lines.push('', '> ' + rep.adText.slice(0, 500).replace(/\n/g, '\n> '));

  const a = g.analysis;
  if (a) {
    lines.push(
      '',
      '| Dimension | Finding |',
      '| --- | --- |',
      `| Hook | ${show(a.hook)} |`,
      `| Offer | ${show(a.offer)} |`,
      `| Pain point | ${show(a.customerPainPoint)} |`,
      `| Desired outcome | ${show(a.desiredOutcome)} |`,
      `| Audience (implied) | ${show(a.audience)} |`,
      `| Funnel stage | ${show(a.funnelStage)} |`,
      `| Emotional triggers | ${showList(a.emotionalTriggers)} |`,
      `| Framework | ${show(a.copywritingFramework)} |`,
      `| Angle | ${show(a.marketingAngle)} |`,
      `| Trust signals | ${showList(a.trustSignals)} |`,
      `| Urgency | ${show(a.urgency)} |`,
      `| Objection handling | ${show(a.objectionHandling)} |`,
    );
  } else if (g.analysisError) {
    lines.push('', `_AI analysis unavailable_: ${g.analysisError}`);
  }
  lines.push('');
  return lines;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
