import type { CreativeGroup } from '../types.js';

/**
 * Volume-weighted aggregations over deduped creatives. "Volume" = number of ad
 * IDs behind a creative (duplicateCount), which reflects how hard the
 * advertiser is pushing it — a spend-emphasis proxy. We report both the ad
 * weighting and the distinct-creative count so nothing is overstated.
 */

export interface Distribution {
  label: string;
  ads: number;
  creatives: number;
  /** Share of total ads (0–100). */
  adSharePct: number;
}

function tally(
  groups: CreativeGroup[],
  labelOf: (g: CreativeGroup) => string | null,
): Distribution[] {
  const byLabel = new Map<string, { ads: number; creatives: number }>();
  let totalAds = 0;
  for (const g of groups) {
    const label = labelOf(g);
    if (!label) continue;
    totalAds += g.duplicateCount;
    const cur = byLabel.get(label) ?? { ads: 0, creatives: 0 };
    cur.ads += g.duplicateCount;
    cur.creatives += 1;
    byLabel.set(label, cur);
  }
  return [...byLabel.entries()]
    .map(([label, v]) => ({
      label,
      ads: v.ads,
      creatives: v.creatives,
      adSharePct: totalAds ? Math.round((v.ads / totalAds) * 100) : 0,
    }))
    .sort((a, b) => b.ads - a.ads);
}

export interface Aggregates {
  totalAds: number;
  uniqueCreatives: number;
  hooks: Distribution[];
  offers: Distribution[];
  funnelStages: Distribution[];
  formats: Distribution[];
  ctas: Distribution[];
  /** Creatives ranked by longevity (proven-winner signal). */
  longestRunning: CreativeGroup[];
}

export function computeAggregates(groups: CreativeGroup[]): Aggregates {
  const totalAds = groups.reduce((n, g) => n + g.duplicateCount, 0);
  return {
    totalAds,
    uniqueCreatives: groups.length,
    // Prefer AI hook; fall back to the headline so the distribution still works
    // when analysis is disabled.
    hooks: tally(groups, (g) => g.analysis?.hook ?? g.headline),
    offers: tally(groups, (g) => g.analysis?.offer ?? null),
    funnelStages: tally(groups, (g) => g.analysis?.funnelStage ?? null),
    formats: tally(groups, (g) => g.creativeType),
    ctas: tally(groups, (g) => g.analysis?.cta ?? g.representative.ctaText),
    longestRunning: [...groups]
      .filter((g) => g.estimatedRuntimeDays !== null)
      .sort((a, b) => (b.estimatedRuntimeDays ?? 0) - (a.estimatedRuntimeDays ?? 0))
      .slice(0, 10),
  };
}
