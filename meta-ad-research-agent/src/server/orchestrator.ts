import type { AdvertiserPage, AnalyzedAd, ResearchResult } from '../types.js';
import { resolveAdvertiser, scoreCandidate } from '../resolver/advertiser-resolver.js';
import { groupCreatives } from '../analyzer/creative-grouper.js';
import { computeReliability } from '../analyzer/reliability.js';
import { DEMO_ADVERTISERS, demoCandidates, isDemoQueryKnown } from './demo-data.js';

/** Whether we run against live Meta or the bundled demo dataset. */
export type Mode = 'demo' | 'live';

export interface CandidateView {
  pageId: string;
  name: string;
  website: string | null;
  industry: string | null;
  confidencePct: number;
  confidence: string;
  reasons: string[];
  verified: boolean;
}

export interface SearchResponse {
  query: string;
  mode: Mode;
  outcome: 'auto' | 'choose' | 'refuse';
  chosenPageId: string | null;
  candidates: CandidateView[];
  message: string | null;
}

function toView(query: string, page: AdvertiserPage): CandidateView {
  const scored = scoreCandidate(query, page);
  return {
    pageId: page.pageId,
    name: page.name,
    website: page.website ?? null,
    industry: page.category,
    confidencePct: scored.confidencePct,
    confidence: scored.confidence,
    reasons: scored.reasons,
    verified: !!page.verification && page.verification.toUpperCase().includes('VERIF'),
  };
}

/**
 * Screen 3 — Smart Advertiser Resolution. Returns the gated decision plus every
 * ranked candidate (so the UI can show alternatives even on auto-accept).
 */
export function searchAdvertiser(query: string, pages: AdvertiserPage[], mode: Mode): SearchResponse {
  const decision = resolveAdvertiser(query, pages);
  const candidates = pages.map((p) => toView(query, p)).sort((a, b) => b.confidencePct - a.confidencePct);

  if (decision.kind === 'refuse') {
    return { query, mode, outcome: 'refuse', chosenPageId: null, candidates, message: decision.reason };
  }
  if (decision.kind === 'accept') {
    return { query, mode, outcome: 'auto', chosenPageId: decision.chosen.pageId, candidates, message: null };
  }
  return { query, mode, outcome: 'choose', chosenPageId: null, candidates, message: null };
}

export type Stage = 'resolving' | 'collecting' | 'deduplicating' | 'analyzing' | 'reporting' | 'done';
export type StageStatus = 'active' | 'done';
export type ProgressFn = (stage: Stage, status: StageStatus, detail?: string) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface AnalyzeInput {
  query: string;
  pageId: string;
  page: AdvertiserPage;
  resolutionConfidencePct: number;
  resolutionMethod: 'auto-accepted' | 'user-selected';
  resolutionReasons: string[];
}

/**
 * Screens 4–5 — run the analysis pipeline for a chosen advertiser, emitting
 * real per-stage progress. Uses the existing engine modules unchanged.
 */
export async function analyzeDemo(input: AnalyzeInput, onProgress: ProgressFn): Promise<ResearchResult> {
  const demo = DEMO_ADVERTISERS[input.pageId];
  const collectedAt = new Date().toISOString();

  onProgress('resolving', 'active', `Confirming ${input.page.name}`);
  await sleep(500);
  onProgress('resolving', 'done', `${input.page.name} · ${input.resolutionConfidencePct}% confidence`);

  onProgress('collecting', 'active', 'Reading the Meta Ad Library');
  await sleep(900);
  const ads: AnalyzedAd[] = demo ? demo.ads : [];
  onProgress('collecting', 'done', `${ads.length} active ads collected`);

  onProgress('deduplicating', 'active', 'Collapsing duplicate creatives');
  await sleep(700);
  const creativeGroups = groupCreatives(ads, { asOf: collectedAt });
  onProgress('deduplicating', 'done', `${ads.length} ads → ${creativeGroups.length} unique creatives`);

  onProgress('analyzing', 'active', 'Analyzing hooks, offers, psychology');
  await sleep(1100);
  onProgress('analyzing', 'done', `${creativeGroups.length} creatives analyzed`);

  onProgress('reporting', 'active', 'Writing the executive briefing');
  await sleep(900);
  const metaReportedApprox = demo ? demo.metaReportedApprox : null;
  const reliability = computeReliability({
    ads,
    groups: creativeGroups,
    advertiserConfidencePct: input.resolutionConfidencePct,
    metaReportedApprox,
    dataSource: 'Meta Ad Library — demo dataset (real ads; body copy/media not in this sample)',
    analysisEnabled: false,
  });
  const result: ResearchResult = {
    advertiser: input.page,
    searchQuery: input.query,
    searchCountry: 'US',
    collectedAt,
    ads,
    creativeGroups,
    report: demo?.report ?? null,
    reportError: demo?.report ? null : 'No analysis available for this advertiser in demo mode.',
    reliability,
    advertiserResolution: {
      confidencePct: input.resolutionConfidencePct,
      method: input.resolutionMethod,
      reasons: input.resolutionReasons,
    },
    adVolume: {
      collectedAds: ads.length,
      uniqueCreatives: creativeGroups.length,
      metaReportedApprox,
      fullyCollected: metaReportedApprox !== null && ads.length >= metaReportedApprox,
    },
  };
  onProgress('reporting', 'done', 'Executive briefing ready');
  onProgress('done', 'done');
  return result;
}

/** Resolve candidate pages for a query (demo dataset or, later, live search). */
export function candidatesFor(query: string, mode: Mode): AdvertiserPage[] {
  if (mode === 'demo') return demoCandidates(query);
  return [];
}

export function demoKnows(query: string): boolean {
  return isDemoQueryKnown(query);
}
