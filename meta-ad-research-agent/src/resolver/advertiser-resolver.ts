import type { AdvertiserPage } from '../types.js';
import { domainParts, similarity } from '../utils/similarity.js';
import { normalizeText } from '../utils/text.js';
import type { AdvertiserCache } from './advertiser-cache.js';

/**
 * Smart Advertiser Resolution with confidence gating.
 *
 * Validation finding (2026-07-16, 18 live companies): keyword search on the Ad
 * Library surfaces the correct advertiser only ~22% of the time — the rest are
 * dropshippers, affiliates, coincidental token matches ("Notion" -> "Notion
 * Pants") and non-English spam. Analyzing the top result blindly profiles the
 * WRONG company, which is worse than returning nothing.
 *
 * Guiding principle: accuracy beats convenience. A customer must never receive
 * a report about the wrong advertiser. So the resolver returns a calibrated
 * confidence (0–1) and gates hard:
 *   confidence > 0.95  -> auto-accept
 *   0.70 – 0.95        -> present ranked choices
 *   < 0.70             -> refuse and explain
 *
 * Signals: exact/prefix/substring name match, fuzzy (edit-distance) match,
 * website/domain match, category/industry match, verified-page scoring,
 * parent/subsidiary ("AG1 by Athletic Greens"), franchise detection, and a
 * historical resolution cache.
 */

export type Confidence = 'high' | 'medium' | 'low' | 'none';

export interface ScoredCandidate {
  page: AdvertiserPage;
  /** Calibrated confidence in [0, 1]. */
  score: number;
  /** Convenience percentage for display (0–100). */
  confidencePct: number;
  confidence: Confidence;
  reasons: string[];
}

export type ResolutionDecision =
  | { kind: 'accept'; chosen: AdvertiserPage; candidate: ScoredCandidate }
  | { kind: 'disambiguate'; candidates: ScoredCandidate[]; franchisePrefix: string | null }
  | { kind: 'refuse'; reason: string; nearMisses: ScoredCandidate[] };

/** Optional context that sharpens matching (from the caller / a brand record). */
export interface ResolverHint {
  /** Known advertiser website/domain, e.g. "solace.health". */
  website?: string;
  /** Expected industry/category, e.g. "Health" or "Software". */
  category?: string;
}

export interface ResolverOptions {
  /** Strictly greater than this auto-accepts (default 0.95). */
  acceptThreshold?: number;
  /** At/above this we present choices; below this we refuse (default 0.70). */
  reviewThreshold?: number;
  /** Max candidates to present when disambiguating (default 8). */
  maxChoices?: number;
  hint?: ResolverHint;
  cache?: AdvertiserCache;
}

const DEFAULTS = {
  acceptThreshold: 0.95,
  reviewThreshold: 0.7,
  maxChoices: 8,
} as const;

/** Generic-brand tokens that must never carry a match on their own. */
const STOPWORDS = new Set([
  'the', 'inc', 'llc', 'co', 'company', 'official', 'shop', 'store',
  'us', 'usa', 'app', 'io', 'com', 'hq', 'ltd', 'group', 'online', 'buy', 'by',
]);

/** Connective tokens that signal a sub-brand relationship ("X by Y"). */
const SUBBRAND_CONNECTORS = new Set(['by', 'from', 'a', 'an']);

export const normalizeName = normalizeText;

export function tokenize(input: string): string[] {
  return normalizeName(input).split(' ').filter((t) => t.length > 0);
}

function contentTokens(tokens: string[]): string[] {
  const content = tokens.filter((t) => !STOPWORDS.has(t));
  return content.length > 0 ? content : tokens;
}

function toConfidence(score: number): Confidence {
  if (score > 0.95) return 'high';
  if (score >= 0.7) return 'medium';
  if (score >= 0.4) return 'low';
  return 'none';
}

/**
 * Score one candidate against the query + optional hint. Deterministic and
 * explainable. Returns confidence in [0, 1].
 */
export function scoreCandidate(query: string, page: AdvertiserPage, hint: ResolverHint = {}): ScoredCandidate {
  const reasons: string[] = [];
  const qNorm = normalizeName(query);
  const nNorm = normalizeName(page.name);
  const qTokens = contentTokens(tokenize(query));
  const nTokensAll = tokenize(page.name);
  const nTokenSet = new Set(nTokensAll);

  let score = 0;

  // --- name relationship (the primary signal) ---
  if (nNorm === qNorm) {
    score = 0.97;
    reasons.push('exact name match');
  } else if (isSubBrandOf(nTokensAll, qTokens)) {
    // "AG1 by Athletic Greens" for query "Athletic Greens": real, but a
    // sub-brand — worth surfacing, not silently auto-accepting.
    score = 0.86;
    reasons.push('sub-brand of the queried company');
  } else if (nNorm.startsWith(qNorm + ' ') || nNorm.endsWith(' ' + qNorm)) {
    score = 0.84;
    reasons.push('name begins/ends with the query');
  } else if (nNorm.includes(qNorm) && qNorm.length >= 4) {
    score = 0.74;
    reasons.push('name contains the full query phrase');
  } else {
    const sim = similarity(qNorm, nNorm);
    const matched = qTokens.filter((t) => nTokenSet.has(t));
    const coverage = qTokens.length ? matched.length / qTokens.length : 0;
    if (sim >= 0.88 && Math.abs(qNorm.length - nNorm.length) <= 2) {
      // Typo / spacing variant, e.g. "monday com" vs "monday.com".
      score = 0.9 * sim;
      reasons.push(`fuzzy name match (${Math.round(sim * 100)}% similar)`);
    } else if (matched.length === 0) {
      reasons.push('no shared brand tokens (likely coincidental match)');
    } else {
      score = 0.34 + 0.34 * coverage; // 1 token of 1 -> 0.68
      reasons.push(`shares ${matched.length}/${qTokens.length} query token(s)`);
      const extra = nTokensAll.filter((t) => !STOPWORDS.has(t)).length - matched.length;
      if (extra >= 3) {
        score -= 0.12;
        reasons.push('name padded with unrelated words');
      }
    }
  }

  // --- website / domain match (strong corroboration) ---
  const hintDomain = hint.website ? domainParts(hint.website) : null;
  const pageDomain = page.website ? domainParts(page.website) : null;
  if (hintDomain && pageDomain && hintDomain.host === pageDomain.host) {
    score = Math.max(score, 0.9) + 0.08;
    reasons.push('advertiser website matches');
  } else if (hintDomain && nTokenSet.has(hintDomain.brand)) {
    score += 0.05;
    reasons.push('name matches expected domain brand');
  }

  // --- category / industry hint ---
  if (hint.category && page.category && normalizeName(page.category).includes(normalizeName(hint.category))) {
    score += 0.05;
    reasons.push('category matches expected industry');
  }

  // --- page-trust signals ---
  if (page.verification && page.verification.toUpperCase().includes('VERIF')) {
    score += 0.08;
    reasons.push('verified page');
  }
  if (page.category) {
    score += 0.02;
    reasons.push('has page category');
  }
  if ((page.likes ?? 0) >= 10_000) {
    score += 0.02;
    reasons.push('established audience');
  }

  score = Math.max(0, Math.min(1, score));
  return { page, score, confidencePct: Math.round(score * 100), confidence: toConfidence(score), reasons };
}

/** "AG1 by Athletic Greens" contains query tokens after a sub-brand connector. */
function isSubBrandOf(nameTokens: string[], queryContentTokens: string[]): boolean {
  if (queryContentTokens.length === 0) return false;
  const connectorIdx = nameTokens.findIndex((t) => SUBBRAND_CONNECTORS.has(t));
  if (connectorIdx <= 0 || connectorIdx === nameTokens.length - 1) return false;
  const tail = nameTokens.slice(connectorIdx + 1);
  return queryContentTokens.every((t) => tail.includes(t));
}

/**
 * Detect a franchise / multi-location brand: several distinct pages whose names
 * all begin with the same strong prefix (e.g. "Orangetheory Fitness ...").
 */
export function detectFranchise(candidates: ScoredCandidate[]): string | null {
  const strong = candidates.filter((c) => c.score >= 0.6);
  if (strong.length < 2) return null;
  const prefixes = strong.map((c) => tokenize(c.page.name).slice(0, 2).join(' '));
  const [first] = prefixes;
  if (first && prefixes.every((p) => p === first)) return first;
  return null;
}

/**
 * Rank candidates and decide: accept / disambiguate / refuse.
 * Never returns a low-confidence pick silently.
 */
export function resolveAdvertiser(
  query: string,
  pages: AdvertiserPage[],
  options: ResolverOptions = {},
): ResolutionDecision {
  const opts = { ...DEFAULTS, ...options };
  const hint = opts.hint ?? {};

  // Historical cache short-circuit: a previously confirmed mapping is trusted.
  const cached = opts.cache?.get(query);
  if (cached) {
    const match = pages.find((p) => p.pageId === cached.pageId);
    const page = match ?? {
      pageId: cached.pageId,
      name: cached.name,
      category: null,
      likes: null,
      verification: null,
      imageUri: null,
      country: null,
    };
    return {
      kind: 'accept',
      chosen: page,
      candidate: {
        page,
        score: 0.99,
        confidencePct: 99,
        confidence: 'high',
        reasons: [`previously confirmed advertiser (cached ${cached.confirmedAt})`],
      },
    };
  }

  // Dedupe by pageId, keep the best-scoring instance.
  const byId = new Map<string, ScoredCandidate>();
  for (const page of pages) {
    const scored = scoreCandidate(query, page, hint);
    const existing = byId.get(page.pageId);
    if (!existing || scored.score > existing.score) byId.set(page.pageId, scored);
  }
  const ranked = [...byId.values()].sort((a, b) => b.score - a.score);

  const reviewable = ranked.filter((c) => c.score >= opts.reviewThreshold);
  if (reviewable.length === 0) {
    return {
      kind: 'refuse',
      reason:
        `No advertiser in the Ad Library confidently matches "${query}" ` +
        `(best candidate ${ranked[0]?.confidencePct ?? 0}% < ${Math.round(opts.reviewThreshold * 100)}% threshold). ` +
        'The results look like impersonators or coincidental keyword matches, so nothing was analyzed. ' +
        'Try the exact page name, add the website/category, or supply the page ID.',
      nearMisses: ranked.slice(0, opts.maxChoices),
    };
  }

  const franchisePrefix = detectFranchise(reviewable);

  // Franchise always asks — the user must choose corporate vs. a location.
  if (franchisePrefix && reviewable.length >= 2) {
    return { kind: 'disambiguate', candidates: reviewable.slice(0, opts.maxChoices), franchisePrefix };
  }

  // Auto-accept ONLY when exactly one candidate clears the review bar and it is
  // above the accept threshold. Two independently-plausible advertisers (e.g.
  // "Solace" the clinic vs. "Solace Clothing") always go to disambiguation —
  // an exact match on a common word is not proof it's the one the user meant.
  const top = reviewable[0]!;
  if (reviewable.length === 1 && top.score > opts.acceptThreshold) {
    return { kind: 'accept', chosen: top.page, candidate: top };
  }

  return { kind: 'disambiguate', candidates: reviewable.slice(0, opts.maxChoices), franchisePrefix: null };
}
