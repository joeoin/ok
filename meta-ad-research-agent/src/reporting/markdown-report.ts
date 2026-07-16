import path from 'node:path';
import type { AnalyzedAd, ResearchResult } from '../types.js';
import type { AssetStore } from '../storage/asset-store.js';
import { writeTextFile } from '../utils/fs.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('markdown');

const NA = '_Not Available_';

const show = (v: string | null | undefined): string => (v && v.trim() !== '' ? v : NA);
const showList = (v: string[] | undefined): string => (v && v.length ? v.join(', ') : NA);

/** Render the full research report as Markdown. Returns the file path. */
export async function writeMarkdownReport(store: AssetStore, result: ResearchResult): Promise<string> {
  const filePath = path.join(store.dirFor('reports'), 'report.md');
  await writeTextFile(filePath, renderMarkdownReport(result));
  log.info(`Wrote Markdown report: ${filePath}`);
  return filePath;
}

export function renderMarkdownReport(result: ResearchResult): string {
  const { advertiser, ads, report } = result;
  const active = ads.filter((a) => a.ad.status === 'active').length;
  const byType = countBy(ads, (a) => a.ad.creativeType);
  const byPlatform = countBy(
    ads.flatMap((a) => (a.ad.platforms.length ? a.ad.platforms : ['unknown'])),
    (p) => p,
  );

  const lines: string[] = [
    `# Meta Ad Library Research: ${advertiser.name}`,
    '',
    `> Generated ${result.collectedAt} · Search query: "${result.searchQuery}" · Country scope: ${result.searchCountry}`,
    `> Source: Meta Ad Library (public data only). Spend, performance, and targeting data are not exposed by the Ad Library and are therefore not included.`,
    '',
    '## Overview',
    '',
    `| Field | Value |`,
    `| --- | --- |`,
    `| Advertiser | ${advertiser.name} |`,
    `| Page ID | ${advertiser.pageId} |`,
    `| Page category | ${show(advertiser.category)} |`,
    `| Verification | ${show(advertiser.verification)} |`,
    `| Ads collected | ${ads.length} (${active} active) |`,
    `| Creative mix | ${formatCounts(byType)} |`,
    `| Platforms | ${formatCounts(byPlatform)} |`,
    '',
  ];

  if (report) {
    lines.push(
      ...section('Executive Summary', report.executiveSummary),
      ...section('Messaging Strategy', report.messagingStrategy),
      ...section('Brand Positioning', report.brandPositioning),
      ...section('Primary Offers', report.primaryOffers),
      ...section('Recurring Hooks', report.recurringHooks),
      ...section('Creative Trends', report.creativeTrends),
      ...section('Audience Strategy', report.audienceStrategy),
      ...section('Funnel Strategy', report.funnelStrategy),
      ...section('Copywriting Patterns', report.copywritingPatterns),
      ...section('CTA Analysis', report.ctaAnalysis),
      ...section('Strengths', report.strengths),
      ...section('Weaknesses', report.weaknesses),
      ...section('Potential Opportunities', report.potentialOpportunities),
      ...section('Recommendations', report.recommendations),
    );
  } else {
    lines.push(
      '## Company-Wide Analysis',
      '',
      `_Not generated_: ${result.reportError ?? 'unknown reason'}`,
      '',
    );
  }

  lines.push('## Ad-by-Ad Breakdown', '');
  ads.forEach((item, i) => lines.push(...renderAd(item, i + 1)));

  return lines.join('\n');
}

function section(title: string, body: string): string[] {
  return [`## ${title}`, '', body.trim() || NA, ''];
}

function renderAd(item: AnalyzedAd, n: number): string[] {
  const { ad, analysis } = item;
  const title = ad.headline ?? (ad.adText ? ad.adText.slice(0, 60).replace(/\s+/g, ' ') + '…' : `Ad ${ad.adArchiveId}`);
  const lines = [
    `### ${n}. ${title}`,
    '',
    `- **Library ID**: [${ad.adArchiveId}](${ad.adLibraryUrl})`,
    `- **Status**: ${ad.status} · **Type**: ${ad.creativeType} · **Platforms**: ${showList(ad.platforms)}`,
    `- **Running since**: ${show(ad.startDate)}`,
    `- **CTA**: ${show(ad.ctaText)} → ${show(ad.landingPageUrl)}`,
  ];
  if (ad.screenshotPath) lines.push(`- **Screenshot**: \`${ad.screenshotPath}\``);
  if (ad.adText) {
    lines.push('', '> ' + ad.adText.slice(0, 500).replace(/\n/g, '\n> '));
  }
  if (analysis) {
    lines.push(
      '',
      '| Dimension | Finding |',
      '| --- | --- |',
      `| Hook | ${show(analysis.hook)} |`,
      `| Offer | ${show(analysis.offer)} |`,
      `| CTA | ${show(analysis.cta)} |`,
      `| Pain point | ${show(analysis.customerPainPoint)} |`,
      `| Desired outcome | ${show(analysis.desiredOutcome)} |`,
      `| Audience (implied) | ${show(analysis.audience)} |`,
      `| Funnel stage | ${show(analysis.funnelStage)} |`,
      `| Emotional triggers | ${showList(analysis.emotionalTriggers)} |`,
      `| Framework | ${show(analysis.copywritingFramework)} |`,
      `| Angle | ${show(analysis.marketingAngle)} |`,
      `| Creative style | ${show(analysis.creativeStyle)} |`,
      `| Trust signals | ${showList(analysis.trustSignals)} |`,
      `| Social proof | ${show(analysis.socialProof)} |`,
      `| Urgency | ${show(analysis.urgency)} |`,
      `| Scarcity | ${show(analysis.scarcity)} |`,
      `| Objection handling | ${show(analysis.objectionHandling)} |`,
      `| Differentiators | ${showList(analysis.differentiators)} |`,
    );
  } else {
    lines.push('', `_AI analysis unavailable_: ${item.analysisError ?? 'unknown'}`);
  }
  lines.push('');
  return lines;
}

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

function formatCounts(counts: Map<string, number>): string {
  if (counts.size === 0) return NA;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
}
