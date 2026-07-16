import type { AdvertiserPage } from '../types.js';
import { resolveAdvertiser, scoreCandidate } from '../resolver/advertiser-resolver.js';

/**
 * Pure resolution mapping used by the web layer. All data comes from the live
 * engine (the scraper) — there is no demo path in the customer experience.
 */

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
  outcome: 'auto' | 'choose' | 'refuse';
  chosenPageId: string | null;
  candidates: CandidateView[];
  message: string | null;
}

export function toView(query: string, page: AdvertiserPage): CandidateView {
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
 * Screen 3 — Smart Advertiser Resolution. Runs the real resolver over the
 * advertiser pages returned by the live search, and returns the gated decision
 * plus every ranked candidate (so the UI can show alternatives on auto-accept).
 */
export function searchAdvertiser(query: string, pages: AdvertiserPage[]): SearchResponse {
  const decision = resolveAdvertiser(query, pages);
  const candidates = pages.map((p) => toView(query, p)).sort((a, b) => b.confidencePct - a.confidencePct);

  if (decision.kind === 'refuse') {
    return { query, outcome: 'refuse', chosenPageId: null, candidates, message: decision.reason };
  }
  if (decision.kind === 'accept') {
    return { query, outcome: 'auto', chosenPageId: decision.chosen.pageId, candidates, message: null };
  }
  return { query, outcome: 'choose', chosenPageId: null, candidates, message: null };
}

export type Stage = 'resolving' | 'collecting' | 'deduplicating' | 'analyzing' | 'reporting' | 'done';
export type StageStatus = 'active' | 'done';
export type ProgressFn = (stage: Stage, status: StageStatus, detail?: string) => void;

export interface AnalyzeInput {
  query: string;
  page: AdvertiserPage;
  resolutionConfidencePct: number;
  resolutionMethod: 'auto-accepted' | 'user-selected';
  resolutionReasons: string[];
}
