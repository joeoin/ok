import path from 'node:path';
import type { CreativeGroup } from '../types.js';
import type { AssetStore } from '../storage/asset-store.js';
import { buildCsv } from '../utils/csv.js';
import { writeTextFile } from '../utils/fs.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('csv');

/** One row per DEDUPLICATED creative (not per ad ID). */
export const CSV_COLUMNS = [
  'creativeId',
  'duplicateCount',
  'advertiserName',
  'pageId',
  'headline',
  'creativeType',
  'platforms',
  'primaryText',
  'description',
  'ctaText',
  'landingPageUrl',
  'firstSeen',
  'lastSeen',
  'estimatedRuntimeDays',
  'countries',
  'languages',
  'exampleAdId',
  'adLibraryUrl',
  'screenshotPath',
  'assetUrls',
  'hook',
  'offer',
  'customerPainPoint',
  'desiredOutcome',
  'audience',
  'funnelStage',
  'emotionalTriggers',
  'copywritingFramework',
  'marketingAngle',
  'creativeStyle',
  'trustSignals',
  'socialProof',
  'urgency',
  'scarcity',
  'objectionHandling',
  'differentiators',
  'analysisError',
];

export function creativeGroupToCsvRow(g: CreativeGroup): Record<string, unknown> {
  const rep = g.representative;
  const a = g.analysis;
  return {
    creativeId: g.creativeId,
    duplicateCount: g.duplicateCount,
    advertiserName: rep.advertiserName,
    pageId: rep.pageId || null,
    headline: g.headline,
    creativeType: g.creativeType,
    platforms: g.platforms,
    primaryText: rep.adText,
    description: rep.description,
    ctaText: rep.ctaText,
    landingPageUrl: rep.landingPageUrl,
    firstSeen: g.firstSeen,
    lastSeen: g.lastSeen,
    estimatedRuntimeDays: g.estimatedRuntimeDays,
    countries: g.countries,
    languages: g.languages,
    exampleAdId: rep.adArchiveId,
    adLibraryUrl: rep.adLibraryUrl,
    screenshotPath: rep.screenshotPath,
    assetUrls: rep.assets.map((x) => x.url ?? x.previewUrl).filter(Boolean),
    hook: a?.hook ?? null,
    offer: a?.offer ?? null,
    customerPainPoint: a?.customerPainPoint ?? null,
    desiredOutcome: a?.desiredOutcome ?? null,
    audience: a?.audience ?? null,
    funnelStage: a?.funnelStage ?? null,
    emotionalTriggers: a?.emotionalTriggers ?? [],
    copywritingFramework: a?.copywritingFramework ?? null,
    marketingAngle: a?.marketingAngle ?? null,
    creativeStyle: a?.creativeStyle ?? null,
    trustSignals: a?.trustSignals ?? [],
    socialProof: a?.socialProof ?? null,
    urgency: a?.urgency ?? null,
    scarcity: a?.scarcity ?? null,
    objectionHandling: a?.objectionHandling ?? null,
    differentiators: a?.differentiators ?? [],
    analysisError: g.analysisError,
  };
}

/** One row per creative group (deduped). Returns the file path. */
export async function exportCsv(store: AssetStore, groups: CreativeGroup[]): Promise<string> {
  const rows = groups.map(creativeGroupToCsvRow);
  const filePath = path.join(store.dirFor('exports'), 'creatives.csv');
  await writeTextFile(filePath, buildCsv(CSV_COLUMNS, rows));
  log.info(`Wrote CSV export: ${filePath}`);
  return filePath;
}
