import path from 'node:path';
import type { AnalyzedAd } from '../types.js';
import type { AssetStore } from '../storage/asset-store.js';
import { buildCsv } from '../utils/csv.js';
import { writeTextFile } from '../utils/fs.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('csv');

export const CSV_COLUMNS = [
  'adArchiveId',
  'advertiserName',
  'pageId',
  'status',
  'platforms',
  'creativeType',
  'displayFormat',
  'adText',
  'headline',
  'description',
  'ctaText',
  'ctaType',
  'landingPageUrl',
  'startDate',
  'endDate',
  'searchCountry',
  'languages',
  'collationCount',
  'adLibraryUrl',
  'screenshotPath',
  'assetUrls',
  'hook',
  'offer',
  'analysisCta',
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

export function analyzedAdToCsvRow(item: AnalyzedAd): Record<string, unknown> {
  const { ad, analysis } = item;
  return {
    adArchiveId: ad.adArchiveId,
    advertiserName: ad.advertiserName,
    pageId: ad.pageId || null,
    status: ad.status,
    platforms: ad.platforms,
    creativeType: ad.creativeType,
    displayFormat: ad.displayFormat,
    adText: ad.adText,
    headline: ad.headline,
    description: ad.description,
    ctaText: ad.ctaText,
    ctaType: ad.ctaType,
    landingPageUrl: ad.landingPageUrl,
    startDate: ad.startDate,
    endDate: ad.endDate,
    searchCountry: ad.searchCountry,
    languages: ad.languages,
    collationCount: ad.collationCount,
    adLibraryUrl: ad.adLibraryUrl,
    screenshotPath: ad.screenshotPath,
    assetUrls: ad.assets.map((a) => a.url ?? a.previewUrl).filter(Boolean),
    hook: analysis?.hook ?? null,
    offer: analysis?.offer ?? null,
    analysisCta: analysis?.cta ?? null,
    customerPainPoint: analysis?.customerPainPoint ?? null,
    desiredOutcome: analysis?.desiredOutcome ?? null,
    audience: analysis?.audience ?? null,
    funnelStage: analysis?.funnelStage ?? null,
    emotionalTriggers: analysis?.emotionalTriggers ?? [],
    copywritingFramework: analysis?.copywritingFramework ?? null,
    marketingAngle: analysis?.marketingAngle ?? null,
    creativeStyle: analysis?.creativeStyle ?? null,
    trustSignals: analysis?.trustSignals ?? [],
    socialProof: analysis?.socialProof ?? null,
    urgency: analysis?.urgency ?? null,
    scarcity: analysis?.scarcity ?? null,
    objectionHandling: analysis?.objectionHandling ?? null,
    differentiators: analysis?.differentiators ?? [],
    analysisError: item.analysisError,
  };
}

/** One row per ad, scraped fields + analysis fields. Returns the file path. */
export async function exportCsv(store: AssetStore, ads: AnalyzedAd[]): Promise<string> {
  const rows = ads.map(analyzedAdToCsvRow);
  const filePath = path.join(store.dirFor('exports'), 'ads.csv');
  await writeTextFile(filePath, buildCsv(CSV_COLUMNS, rows));
  log.info(`Wrote CSV export: ${filePath}`);
  return filePath;
}
