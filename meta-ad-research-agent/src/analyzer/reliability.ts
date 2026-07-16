import type { AnalyzedAd, CreativeGroup, ReliabilityScores } from '../types.js';

/**
 * Reliability Layer.
 *
 * Every report must tell the customer how much to trust it. We compute honest
 * 0–100 sub-scores and, crucially, explain anything that lowered them — so a
 * thin report is transparent rather than misleading. Nothing here fabricates:
 * unknown coverage is reported as unknown, not padded.
 */

export interface ReliabilityInput {
  ads: AnalyzedAd[];
  groups: CreativeGroup[];
  /** Confidence the advertiser was correctly identified (0–100). */
  advertiserConfidencePct: number;
  /** Estimated active-ad population from discovery; null if not exposed. */
  estimatedPopulation: number | null;
  dataSource: string;
  analysisEnabled: boolean;
}

/** Per-ad fields that a "complete" record would carry. */
const COMPLETENESS_FIELDS: Array<{ key: string; has: (a: AnalyzedAd['ad']) => boolean }> = [
  { key: 'primary text', has: (a) => !!a.adText },
  { key: 'headline', has: (a) => !!a.headline },
  { key: 'description', has: (a) => !!a.description },
  { key: 'CTA', has: (a) => !!a.ctaText },
  { key: 'landing page', has: (a) => !!a.landingPageUrl },
  { key: 'platforms', has: (a) => a.platforms.length > 0 },
  { key: 'first-seen date', has: (a) => !!a.startDate },
  { key: 'creative asset', has: (a) => a.assets.length > 0 },
];

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

export function computeReliability(input: ReliabilityInput): ReliabilityScores {
  const { ads, groups, advertiserConfidencePct, estimatedPopulation, dataSource, analysisEnabled } = input;
  const explanations: string[] = [];

  // --- data completeness: average fraction of fields present across ads ---
  const missingByField = new Map<string, number>();
  let completenessSum = 0;
  for (const item of ads) {
    let present = 0;
    for (const f of COMPLETENESS_FIELDS) {
      if (f.has(item.ad)) present++;
      else missingByField.set(f.key, (missingByField.get(f.key) ?? 0) + 1);
    }
    completenessSum += present / COMPLETENESS_FIELDS.length;
  }
  const dataCompleteness = ads.length ? clamp((completenessSum / ads.length) * 100) : 0;
  const mostlyMissing = [...missingByField.entries()]
    .filter(([, n]) => n >= ads.length * 0.9 && ads.length > 0)
    .map(([k]) => k);
  if (mostlyMissing.length) {
    explanations.push(
      `Fields not exposed by the data source for (nearly) all ads: ${mostlyMissing.join(', ')}. ` +
        'These require full-creative capture via the browser scraper.',
    );
  }

  // --- coverage: collected vs. estimated population ---
  const collectedTotal = groups.reduce((n, g) => n + g.duplicateCount, 0);
  let coverage: number;
  let coverageInOverall = true;
  if (estimatedPopulation && estimatedPopulation > 0) {
    coverage = clamp((collectedTotal / estimatedPopulation) * 100);
    if (coverage < 100) {
      explanations.push(
        `Collected ${collectedTotal} of ~${estimatedPopulation} active ads ` +
          `(${coverage}%). The rest were beyond the current page/scroll or API result cap.`,
      );
    }
  } else {
    coverage = 100;
    coverageInOverall = false;
    explanations.push(
      'Active-ad population size is not exposed, so coverage cannot be measured; ' +
        'treat the collected set as a recent sample, not the full population.',
    );
  }

  // --- creative coverage: share of creatives with a usable asset ---
  const groupsWithAsset = groups.filter(
    (g) => g.representative.assets.length > 0 || g.representative.screenshotPath !== null,
  ).length;
  const creativeCoverage = groups.length ? clamp((groupsWithAsset / groups.length) * 100) : 0;
  if (groups.length && creativeCoverage < 100) {
    explanations.push(
      `${groups.length - groupsWithAsset} of ${groups.length} creatives have no downloadable image/video ` +
        'or screenshot (asset URLs not exposed, or capture was blocked).',
    );
  }

  if (!analysisEnabled) {
    explanations.push('AI analysis was disabled (LLM_PROVIDER=none); strategic fields are unpopulated.');
  }
  if (advertiserConfidencePct < 100) {
    explanations.push(`Advertiser identified with ${advertiserConfidencePct}% confidence (see resolution reasons).`);
  }

  // --- overall: weighted blend of determinable sub-scores ---
  const weights: Array<[number, number]> = [
    [advertiserConfidencePct, 0.4],
    [dataCompleteness, 0.25],
    [creativeCoverage, 0.2],
  ];
  if (coverageInOverall) weights.push([coverage, 0.15]);
  const wSum = weights.reduce((s, [, w]) => s + w, 0);
  const overall = clamp(weights.reduce((s, [v, w]) => s + v * w, 0) / wSum);

  return {
    overall,
    advertiserConfidence: clamp(advertiserConfidencePct),
    dataCompleteness,
    coverage,
    creativeCoverage,
    missingDataExplanations: explanations,
    dataSource,
  };
}
