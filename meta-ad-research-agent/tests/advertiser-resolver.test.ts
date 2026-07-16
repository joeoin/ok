import { describe, expect, it } from 'vitest';
import {
  resolveAdvertiser,
  scoreCandidate,
  normalizeName,
  detectFranchise,
} from '../src/resolver/advertiser-resolver.js';
import { InMemoryAdvertiserCache } from '../src/resolver/advertiser-cache.js';
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
  website: over.website ?? null,
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

describe('scoreCandidate — signals', () => {
  it('exact match scores high confidence (>95%)', () => {
    expect(scoreCandidate('Manscaped', page('MANSCAPED')).score).toBeGreaterThan(0.95);
  });

  it('coincidental token matches score as "none" confidence', () => {
    const s = scoreCandidate('Notion', page('Niepce Clothing Inc'));
    expect(s.confidence).toBe('none');
    expect(s.reasons.join(' ')).toMatch(/no shared brand tokens/);
  });

  it('fuzzy-matches spacing/typo variants', () => {
    // "Monday.com" normalizes to "monday com" == the page -> exact.
    const spacing = scoreCandidate('Monday.com', page('monday com', { category: 'Software' }));
    expect(spacing.score).toBeGreaterThan(0.9);
    // A genuine typo should still match via edit distance.
    const typo = scoreCandidate('Robinhod', page('Robinhood'));
    expect(typo.reasons.join(' ')).toMatch(/fuzzy name match/);
    expect(typo.score).toBeGreaterThan(0.7);
  });

  it('detects a sub-brand (parent/subsidiary): "AG1 by Athletic Greens"', () => {
    const s = scoreCandidate('Athletic Greens', page('AG1 by Athletic Greens'));
    expect(s.reasons.join(' ')).toMatch(/sub-brand/);
    expect(s.confidence).toBe('medium'); // 0.70–0.95 -> ranked choice, not auto
  });

  it('boosts on website/domain match', () => {
    const withDomain = scoreCandidate('Solace', page('Solace', { website: 'solace.health' }), {
      website: 'https://www.solace.health/',
    });
    expect(withDomain.reasons.join(' ')).toMatch(/website matches/);
    expect(withDomain.score).toBeGreaterThan(0.95);
  });

  it('boosts on category/industry hint match', () => {
    const base = scoreCandidate('Acme', page('Acme Labs'));
    const withCat = scoreCandidate('Acme', page('Acme Labs', { category: 'Software company' }), {
      category: 'Software',
    });
    expect(withCat.score).toBeGreaterThan(base.score);
  });

  it('boosts verified pages', () => {
    const plain = scoreCandidate('Beam', page('Beam Wallet'));
    const verified = scoreCandidate('Beam', page('Beam Wallet', { verification: 'BLUE_VERIFIED' }));
    expect(verified.score).toBeGreaterThan(plain.score);
  });
});

describe('resolveAdvertiser — refuses (<70%)', () => {
  it('refuses when only impersonators/coincidental matches exist (HubSpot)', () => {
    const d = resolveAdvertiser('HubSpot', [
      page('Rapid Drama Hub'),
      page('California Overland Adventure and Power Sports Show'),
      page('MTE BridgeSaw'),
    ]);
    expect(d.kind).toBe('refuse');
    if (d.kind === 'refuse') expect(d.reason).toMatch(/nothing was analyzed/);
  });

  it('refuses the 2-letter "Ro" query that returned pure noise', () => {
    const d = resolveAdvertiser('Ro', [page('NextChapter'), page('New You Brighton CO'), page('Samantha Taravella - Realtor')]);
    expect(d.kind).toBe('refuse');
  });

  it('refuses SoFi (token exploded into 3.1M junk results)', () => {
    const d = resolveAdvertiser('SoFi', [page("H'page 4227"), page('Fly Technology'), page('Melinda Maria Jewelry')]);
    expect(d.kind).toBe('refuse');
  });
});

describe('resolveAdvertiser — auto-accepts (>95%)', () => {
  it('auto-accepts a coined-name exact match (Manscaped)', () => {
    const d = resolveAdvertiser('Manscaped', [page('MANSCAPED', { pageId: '1545577295743703', category: 'Health/beauty' })]);
    expect(d.kind).toBe('accept');
    if (d.kind === 'accept') {
      expect(d.chosen.pageId).toBe('1545577295743703');
      expect(d.candidate.confidencePct).toBeGreaterThan(95);
    }
  });

  it('picks the real brand over affiliate noise (hims)', () => {
    const d = resolveAdvertiser('Hims', [
      page('Information Explorer Pro'),
      page('hims', { pageId: '355136938262536', category: 'Health/beauty' }),
      page("Mother's Day Every Day"),
    ]);
    expect(d.kind).toBe('accept');
    if (d.kind === 'accept') expect(d.chosen.pageId).toBe('355136938262536');
  });

  it('auto-accepts on a website match even for a common word', () => {
    const d = resolveAdvertiser(
      'Solace',
      [page('Solace', { pageId: '110702245120634', website: 'solace.health', category: 'Medical' })],
      { hint: { website: 'https://solace.health' } },
    );
    expect(d.kind).toBe('accept');
  });
});

describe('resolveAdvertiser — disambiguates (70–95% or multiple plausible)', () => {
  it('asks when a sub-brand is the only match (Athletic Greens -> AG1)', () => {
    const d = resolveAdvertiser('Athletic Greens', [page('AG1 by Athletic Greens', { pageId: '183869772601' })]);
    expect(d.kind).toBe('disambiguate');
  });

  it('disambiguates a franchise brand (Orangetheory corporate + studios)', () => {
    const d = resolveAdvertiser('Orangetheory Fitness', [
      page('Orangetheory Fitness', { pageId: '309888102314' }),
      page('Orangetheory Fitness Chino Hills', { pageId: '884618614907133' }),
      page('Orangetheory Fitness Exton', { pageId: '316784861988688' }),
    ]);
    expect(d.kind).toBe('disambiguate');
    if (d.kind === 'disambiguate') expect(d.franchisePrefix).toBe('orangetheory fitness');
  });

  it('disambiguates distinct real companies sharing a name (Solace)', () => {
    const d = resolveAdvertiser('Solace', [
      page('Solace', { pageId: '110702245120634', category: 'Medical company' }),
      page('Solace Clothing', { pageId: '1011065425433807', category: 'Clothing' }),
      page('Solace Caskets', { pageId: '278650805328968' }),
    ]);
    // Two+ plausible advertisers -> never silently pick the exact match.
    expect(d.kind).toBe('disambiguate');
  });
});

describe('resolveAdvertiser — historical cache', () => {
  it('short-circuits to a confirmed advertiser even when search is noisy', () => {
    const cache = new InMemoryAdvertiserCache({
      chime: { pageId: '999000111', name: 'Chime', confirmedAt: '2026-07-01T00:00:00Z' },
    });
    const d = resolveAdvertiser('Chime', [page('NS-by-07'), page('Davis Auto Sales')], { cache });
    expect(d.kind).toBe('accept');
    if (d.kind === 'accept') {
      expect(d.chosen.pageId).toBe('999000111');
      expect(d.candidate.confidencePct).toBe(99);
    }
  });

  it('remembers and reuses a resolution', () => {
    const cache = new InMemoryAdvertiserCache();
    cache.remember('My Brand', { pageId: '42', name: 'My Brand' }, '2026-07-16T00:00:00Z');
    expect(cache.get('  my   brand ')?.pageId).toBe('42');
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
    const cands = [scoreCandidate('Solace', page('Solace')), scoreCandidate('Solace', page('Solace Clothing'))];
    expect(detectFranchise(cands)).toBeNull();
  });
});
