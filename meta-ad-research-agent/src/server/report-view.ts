import type { CompanyReport, ReliabilityScores, ResearchResult } from '../types.js';
import { computeAggregates, type Distribution } from '../analyzer/aggregate.js';
import { summarizeCreatives } from '../analyzer/creative-grouper.js';

/** A flattened, presentation-ready view of a research result for the UI + PDF. */
export interface ReportView {
  advertiser: { name: string; website: string | null; industry: string | null; verified: boolean };
  createdAt: string;
  headline: {
    collectedAds: number;
    uniqueCreatives: number;
    metaReportedApprox: number | null;
    fullyCollected: boolean;
    topCreative: { headline: string | null; duplicateCount: number; runtimeDays: number | null } | null;
  };
  reliability: ReliabilityScores & { advertiserMethod: string };
  report: CompanyReport | null;
  reportError: string | null;
  winners: Array<{ rank: number; headline: string | null; duplicateCount: number; runtimeDays: number | null; creativeType: string }>;
  hooks: Distribution[];
  offers: Distribution[];
  funnel: Distribution[];
  formats: Distribution[];
}

export function buildReportView(result: ResearchResult): ReportView {
  const agg = computeAggregates(result.creativeGroups);
  const summary = summarizeCreatives(result.creativeGroups);
  const top = summary.topCreative;

  return {
    advertiser: {
      name: result.advertiser.name,
      website: result.advertiser.website ?? null,
      industry: result.advertiser.category,
      verified: !!result.advertiser.verification && result.advertiser.verification.toUpperCase().includes('VERIF'),
    },
    createdAt: result.collectedAt,
    headline: {
      collectedAds: result.adVolume.collectedAds,
      uniqueCreatives: result.adVolume.uniqueCreatives,
      metaReportedApprox: result.adVolume.metaReportedApprox,
      fullyCollected: result.adVolume.fullyCollected,
      topCreative: top ? { headline: top.headline, duplicateCount: top.duplicateCount, runtimeDays: top.estimatedRuntimeDays } : null,
    },
    reliability: { ...result.reliability, advertiserMethod: result.advertiserResolution.method },
    report: result.report,
    reportError: result.reportError,
    winners: result.creativeGroups.slice(0, 8).map((g, i) => ({
      rank: i + 1,
      headline: g.headline,
      duplicateCount: g.duplicateCount,
      runtimeDays: g.estimatedRuntimeDays,
      creativeType: g.creativeType,
    })),
    hooks: agg.hooks.slice(0, 8),
    offers: agg.offers.slice(0, 8),
    funnel: agg.funnelStages,
    formats: agg.formats,
  };
}
