import type { AdRecord, AnalyzedAd, CreativeGroup } from '../types.js';

/**
 * Creative deduplication.
 *
 * Validation finding: Meta runs one creative across many ad IDs (Solace: 678
 * ads -> 12 creatives; hims/AG1: 8 identical ads). Counting ad IDs inflates
 * apparent strategy ~50x and buries the real signal. The Creative Group is the
 * true unit of analysis: "678 ads" -> "12 unique creatives" -> "top creative".
 */

/** Stable, dependency-free string hash (djb2) for creative signatures. */
function hashString(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const norm = (v: string | null | undefined): string =>
  (v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Basename of an asset URL, ignoring query strings and CDN token noise. */
function assetKey(url: string | null): string {
  if (!url) return '';
  try {
    const p = new URL(url).pathname;
    return p.slice(p.lastIndexOf('/') + 1);
  } catch {
    return url.slice(0, 40);
  }
}

/**
 * Signature identifying one distinct creative. Uses whatever fields are
 * present; for API-thin data (headline only) it degrades gracefully to
 * headline + format, which is exactly how Meta duplicates those ads.
 */
export function creativeSignature(ad: AdRecord): string {
  const assetKeys = ad.assets
    .map((a) => assetKey(a.url ?? a.previewUrl))
    .filter(Boolean)
    .sort()
    .join(',');
  const parts = [
    norm(ad.headline),
    norm(ad.adText),
    norm(ad.description),
    norm(ad.ctaText),
    norm(ad.landingPageUrl),
    ad.creativeType,
    assetKeys,
  ];
  return 'cg_' + hashString(parts.join('␟'));
}

const dateMin = (a: string | null, b: string | null): string | null =>
  a && b ? (a < b ? a : b) : (a ?? b);
const dateMax = (a: string | null, b: string | null): string | null =>
  a && b ? (a > b ? a : b) : (a ?? b);

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isNaN(ms) ? 0 : Math.max(0, Math.round(ms / 86_400_000));
}

/** Count non-empty fields, to pick the most complete representative. */
function completeness(ad: AdRecord): number {
  const fields = [ad.adText, ad.headline, ad.description, ad.ctaText, ad.landingPageUrl, ad.startDate];
  return fields.filter(Boolean).length + ad.assets.length + (ad.screenshotPath ? 1 : 0);
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export interface GroupOptions {
  /** ISO date the run collected data; used to age active creatives. */
  asOf?: string;
}

/**
 * Collapse analyzed ads into ranked Creative Groups. Ranking favors, in order:
 * duplication (spend-concentration proxy), longevity (proven winner), and
 * coverage (platforms x countries).
 */
export function groupCreatives(ads: AnalyzedAd[], options: GroupOptions = {}): CreativeGroup[] {
  const asOf = options.asOf ? options.asOf.slice(0, 10) : null;
  const groups = new Map<string, AnalyzedAd[]>();

  for (const item of ads) {
    const sig = creativeSignature(item.ad);
    const bucket = groups.get(sig);
    if (bucket) bucket.push(item);
    else groups.set(sig, [item]);
  }

  const result: CreativeGroup[] = [];
  for (const [creativeId, members] of groups) {
    const rep = members.reduce((best, m) => (completeness(m.ad) > completeness(best.ad) ? m : best), members[0]!);

    let firstSeen: string | null = null;
    let lastSeen: string | null = null;
    let anyActive = false;
    const countries: string[] = [];
    const languages: string[] = [];
    const platforms: string[] = [];

    for (const { ad } of members) {
      firstSeen = dateMin(firstSeen, ad.startDate);
      lastSeen = dateMax(lastSeen, dateMax(ad.startDate, ad.endDate));
      if (ad.status === 'active') anyActive = true;
      countries.push(ad.searchCountry);
      languages.push(...ad.languages);
      platforms.push(...ad.platforms);
    }

    // Active creatives are still running as of the collection date.
    const effectiveLast = anyActive && asOf ? dateMax(lastSeen, asOf) : lastSeen;
    const estimatedRuntimeDays =
      firstSeen && effectiveLast ? daysBetween(firstSeen, effectiveLast) : null;

    result.push({
      creativeId,
      duplicateCount: members.length,
      adArchiveIds: members.map((m) => m.ad.adArchiveId),
      representative: rep.ad,
      headline: rep.ad.headline,
      creativeType: rep.ad.creativeType,
      firstSeen,
      lastSeen: effectiveLast,
      estimatedRuntimeDays,
      countries: uniq(countries),
      languages: uniq(languages),
      platforms: uniq(platforms),
      analysis: rep.analysis,
      analysisError: rep.analysisError,
    });
  }

  return rankCreativeGroups(result);
}

/** Composite ranking: duplication, then runtime, then coverage. */
export function rankCreativeGroups(groups: CreativeGroup[]): CreativeGroup[] {
  return [...groups].sort((a, b) => {
    if (b.duplicateCount !== a.duplicateCount) return b.duplicateCount - a.duplicateCount;
    const ra = a.estimatedRuntimeDays ?? 0;
    const rb = b.estimatedRuntimeDays ?? 0;
    if (rb !== ra) return rb - ra;
    const ca = a.countries.length + a.platforms.length;
    const cb = b.countries.length + b.platforms.length;
    return cb - ca;
  });
}

export interface CreativeSummary {
  totalAds: number;
  uniqueCreatives: number;
  duplicationRatio: number;
  topCreative: CreativeGroup | null;
}

export function summarizeCreatives(groups: CreativeGroup[]): CreativeSummary {
  const totalAds = groups.reduce((n, g) => n + g.duplicateCount, 0);
  return {
    totalAds,
    uniqueCreatives: groups.length,
    duplicationRatio: groups.length ? Number((totalAds / groups.length).toFixed(1)) : 0,
    topCreative: groups[0] ?? null,
  };
}
