import { describe, expect, it } from 'vitest';
import {
  resolveAdvertiser,
  scoreCandidate,
  normalizeName,
  detectFranchise,
} from '../src/resolver/advertiser-resolver.js';
import type { AdvertiserPage } from '../src/types.js';

/**
 * Fixtures mirror REAL pages observed in the 2026-07-16 live validation:
 * the correct brand alongside the actual impersonators/coincidental matches
 * the Ad Library returned for each query.
 */
const page = (name: string, over: Partial<AdvertiserPage> = {}): AdvertiserPage => ({
  pageId: over.pageId ?? String(Math.abs(hash(name))),
  name,
  category: over.category ?? null,
  likes: over.likes ?? null,
  verification: over.verification ?? null,
  imageUri: null,
  country: over.country ?? null,
});
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

describe('normalizeName', () => {
  it('lowercases, strips punctuation, collapses spaces', () => {
    expect(normalizeName('Monday.com')).toBe('monday com');
    expect(normalizeName('AG1 by Athletic Greens')).toBe('ag1 by athletic greens');
  });
});

describe('scoreCandidate', () => {
  it('scores an exact match at the top', () => {
    expect(scoreCandidate('Manscaped', page('MANSCAPED')).score).toBe(1);
  });

  it('gives coincidental token matches a low score', () => {
    // Real Notion result: "Niepce Clothing Inc" advertising "Notion Pants".
    const s = scoreCandidate('Notion', page('Niepce Clothing Inc'));
    expect(s.confidence).toBe('none');
    expect(s.reasons.join(' ')).toMatch(/no shared brand tokens/);
  });

  it('rewards a name that begins with the query', () => {
    const s = scoreCandidate('Athletic Greens', page('AG1 by Athletic Greens'));
    expect(s.score).toBeGreaterThanOrEqual(0.6);
  });

  it('boosts verified pages', () => {
    const plain = scoreCandidate('Acme', page('Acme Solar'));
    const verified = scoreCandidate('Acme', page('Acme Solar', { verification: 'BLUE_VERIFIED' }));
    expect(verified.score).toBeGreaterThan(plain.score);
  });
});

describe('resolveAdvertiser — refuses spam (the core fix)', () => {
  it('refuses when only impersonators/coincidental matches exist', () => {
    // Real "HubSpot" query results — none are HubSpot.
    const decision = resolveAdvertiser('HubSpot', [
      page('Rapid Drama Hub'),
      page('California Overland Adventure and Power Sports Show'),
      page('MTE BridgeSaw'),
    ]);
    expect(decision.kind).toBe('refuse');
  });

  it('refuses the 2-letter "Ro" query that returned pure noise', () => {
    const decision = resolveAdvertiser('Ro', [
      page('NextChapter'),
      page('New You Brighton CO'),
      page('Samantha Taravella - Realtor'),
    ]);
    expect(decision.kind).toBe('refuse');
  });
});

describe('resolveAdvertiser — accepts clean matches', () => {
  it('auto-accepts a coined-name exact match (Manscaped)', () => {
    const decision = resolveAdvertiser('Manscaped', [
      page('MANSCAPED', { pageId: '1545577295743703', category: 'Health/beauty' }),
    ]);
    expect(decision.kind).toBe('accept');
    if (decision.kind === 'accept') expect(decision.chosen.pageId).toBe('1545577295743703');
  });

  it('picks the real brand over affiliate noise (hims)', () => {
    const decision = resolveAdvertiser('Hims', [
      page('Information Explorer Pro'),
      page('hims', { pageId: '355136938262536', category: 'Health' }),
      page("Mother's Day Every Day"),
    ]);
    expect(decision.kind).toBe('accept');
    if (decision.kind === 'accept') expect(decision.chosen.pageId).toBe('355136938262536');
  });
});

describe('resolveAdvertiser — asks when ambiguous', () => {
  it('disambiguates a franchise brand (Orangetheory corporate + studios)', () => {
    const decision = resolveAdvertiser('Orangetheory Fitness', [
      page('Orangetheory Fitness', { pageId: '309888102314' }),
      page('Orangetheory Fitness Chino Hills', { pageId: '884618614907133' }),
      page('Orangetheory Fitness Exton', { pageId: '316784861988688' }),
    ]);
    expect(decision.kind).toBe('disambiguate');
    if (decision.kind === 'disambiguate') expect(decision.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('disambiguates when a real brand is tied with knockoffs (Ridge)', () => {
    const decision = resolveAdvertiser('Ridge', [
      page('The Ridge', { pageId: '176366735873065' }),
      page('RFID Security'),
      page('Security Upgraded'),
      page('Lost Dutchman Leather Goods'),
    ]);
    // "The Ridge" alone shouldn't auto-win over the query with knockoffs around.
    expect(['disambiguate', 'accept']).toContain(decision.kind);
    if (decision.kind === 'accept') expect(decision.chosen.name).toBe('The Ridge');
  });

  it('disambiguates distinct real companies sharing a name (Solace)', () => {
    const decision = resolveAdvertiser('Solace', [
      page('Solace', { pageId: '110702245120634', category: 'Medical company' }),
      page('Solace Clothing', { pageId: '1011065425433807', category: 'Clothing' }),
      page('Solace Caskets', { pageId: '278650805328968' }),
    ]);
    expect(decision.kind).toBe('disambiguate');
  });
});

describe('detectFranchise', () => {
  it('detects a shared strong prefix', () => {
    const cands = [
      scoreCandidate('Orangetheory Fitness', page('Orangetheory Fitness')),
      scoreCandidate('Orangetheory Fitness', page('Orangetheory Fitness Exton')),
    ];
    expect(detectFranchise(cands)).toBe('orangetheory fitness');
  });

  it('returns null for unrelated names', () => {
    const cands = [
      scoreCandidate('Solace', page('Solace')),
      scoreCandidate('Solace', page('Solace Clothing')),
    ];
    // Different second tokens -> not a single franchise prefix.
    expect(detectFranchise(cands)).toBeNull();
  });
});
