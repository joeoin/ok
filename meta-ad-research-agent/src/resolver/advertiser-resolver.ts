import type { AdvertiserPage } from '../types.js';

/**
 * Advertiser resolution + confidence gating.
 *
 * Validation finding (2026-07-16, 18 live companies): keyword search on the Ad
 * Library surfaces the correct advertiser only ~22% of the time — the rest is
 * dropshippers, affiliates, coincidental token matches ("Notion" -> "Notion
 * Pants") and non-English spam. Blindly analyzing the top result profiles the
 * WRONG company, which is worse than returning nothing.
 *
 * This module scores candidate pages against the query, filters junk, and
 * decides whether to auto-accept, ask the user, or refuse — so the pipeline
 * never silently researches an impersonator.
 */

export type Confidence = 'high' | 'medium' | 'low' | 'none';

export interface ScoredCandidate {
  page: AdvertiserPage;
  score: number;
  confidence: Confidence;
  reasons: string[];
}

export type ResolutionDecision =
  | { kind: 'accept'; chosen: AdvertiserPage; candidate: ScoredCandidate }
  | { kind: 'disambiguate'; candidates: ScoredCandidate[] }
  | { kind: 'refuse'; reason: string; nearMisses: ScoredCandidate[] };

export interface ResolverOptions {
  /** Min score to auto-accept without asking (default 0.82). */
  acceptThreshold?: number;
  /** Min lead over the runner-up to auto-accept a single winner (default 0.15). */
  leadThreshold?: number;
  /** Below this, a candidate is not a plausible match at all (default 0.34). */
  minPlausibleScore?: number;
  /** Max candidates to present when disambiguating (default 8). */
  maxChoices?: number;
}

const DEFAULTS: Required<ResolverOptions> = {
  acceptThreshold: 0.82,
  leadThreshold: 0.15,
  minPlausibleScore: 0.34,
  maxChoices: 8,
};

/** Generic-brand tokens that must never carry a match on their own. */
const STOPWORDS = new Set([
  'the', 'inc', 'llc', 'co', 'company', 'official', 'shop', 'store', 'store',
  'us', 'usa', 'app', 'io', 'com', 'hq', 'ltd', 'group', 'online', 'buy',
]);

export function normalizeName(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenize(input: string): string[] {
  return normalizeName(input)
    .split(' ')
    .filter((t) => t.length > 0);
}

function contentTokens(tokens: string[]): string[] {
  const content = tokens.filter((t) => !STOPWORDS.has(t));
  return content.length > 0 ? content : tokens;
}

/**
 * Score one candidate page name against the query in [0, 1].
 * Deterministic and explainable (returns the reasons used).
 */
export function scoreCandidate(query: string, page: AdvertiserPage): ScoredCandidate {
  const reasons: string[] = [];
  const qNorm = normalizeName(query);
  const nNorm = normalizeName(page.name);
  const qTokens = contentTokens(tokenize(query));
  const nTokens = tokenize(page.name);
  const nTokenSet = new Set(nTokens);

  let score = 0;

  if (nNorm === qNorm) {
    score = 1;
    reasons.push('exact name match');
  } else if (nNorm.startsWith(qNorm + ' ') || nNorm.endsWith(' ' + qNorm)) {
    score = 0.9;
    reasons.push('name begins/ends with the query');
  } else if (nNorm.includes(qNorm) && qNorm.length >= 4) {
    score = 0.78;
    reasons.push('name contains the full query phrase');
  } else {
    // Token-overlap fallback: fraction of query tokens present in the name.
    const matched = qTokens.filter((t) => nTokenSet.has(t));
    const coverage = qTokens.length ? matched.length / qTokens.length : 0;
    if (matched.length === 0) {
      reasons.push('no shared brand tokens (likely coincidental match)');
    } else {
      score = 0.34 + 0.42 * coverage; // 1 token of 1 -> 0.76; partial -> lower
      reasons.push(`shares ${matched.length}/${qTokens.length} query token(s)`);
      // Penalize noisy names padded with extra tokens (dropshipper style).
      const extra = nTokens.filter((t) => !STOPWORDS.has(t)).length - matched.length;
      if (extra >= 3) {
        score -= 0.12;
        reasons.push('name padded with unrelated words');
      }
    }
  }

  // Signal boosts (page-shaped candidates are more trustworthy than ad-derived).
  if (page.verification && page.verification.toUpperCase().includes('VERIF')) {
    score += 0.08;
    reasons.push('verified page');
  }
  if (page.category) {
    score += 0.03;
    reasons.push('has page category');
  }
  if ((page.likes ?? 0) >= 10_000) {
    score += 0.03;
    reasons.push('established audience');
  }

  score = Math.max(0, Math.min(1, score));
  return { page, score, confidence: toConfidence(score), reasons };
}

function toConfidence(score: number): Confidence {
  if (score >= 0.82) return 'high';
  if (score >= 0.6) return 'medium';
  if (score >= 0.34) return 'low';
  return 'none';
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
 * Rank candidates and decide what to do. Never returns a low-confidence pick
 * silently — that is the whole point.
 */
export function resolveAdvertiser(
  query: string,
  pages: AdvertiserPage[],
  options: ResolverOptions = {},
): ResolutionDecision {
  const opts = { ...DEFAULTS, ...options };

  // Dedupe by pageId, keep the best-scoring instance.
  const byId = new Map<string, ScoredCandidate>();
  for (const page of pages) {
    const scored = scoreCandidate(query, page);
    const existing = byId.get(page.pageId);
    if (!existing || scored.score > existing.score) byId.set(page.pageId, scored);
  }
  const ranked = [...byId.values()].sort((a, b) => b.score - a.score);

  const plausible = ranked.filter((c) => c.score >= opts.minPlausibleScore);
  if (plausible.length === 0) {
    return {
      kind: 'refuse',
      reason:
        `No advertiser in the Ad Library confidently matches "${query}". ` +
        'The results look like impersonators or coincidental keyword matches, ' +
        'so nothing was analyzed. Try the exact page name, or supply the page ID.',
      nearMisses: ranked.slice(0, opts.maxChoices),
    };
  }

  const [top, second] = plausible;

  // Franchise: many same-prefix pages — always let the user choose scope.
  const franchisePrefix = detectFranchise(plausible);
  if (franchisePrefix && plausible.length >= 2) {
    return { kind: 'disambiguate', candidates: plausible.slice(0, opts.maxChoices) };
  }

  const lead = top!.score - (second?.score ?? 0);
  if (top!.score >= opts.acceptThreshold && (!second || lead >= opts.leadThreshold)) {
    return { kind: 'accept', chosen: top!.page, candidate: top! };
  }

  // Otherwise ambiguous enough to warrant a human choice.
  return { kind: 'disambiguate', candidates: plausible.slice(0, opts.maxChoices) };
}
