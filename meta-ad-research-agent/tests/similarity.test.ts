import { describe, expect, it } from 'vitest';
import { levenshtein, similarity, domainParts } from '../src/utils/similarity.js';

describe('levenshtein', () => {
  it('is 0 for identical strings', () => {
    expect(levenshtein('nike', 'nike')).toBe(0);
  });
  it('counts single edits', () => {
    expect(levenshtein('robinhod', 'robinhood')).toBe(1);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });
});

describe('similarity', () => {
  it('is 1 for identical, high for near, low for different', () => {
    expect(similarity('solace', 'solace')).toBe(1);
    expect(similarity('robinhod', 'robinhood')).toBeGreaterThan(0.85);
    expect(similarity('notion', 'niepce')).toBeLessThan(0.5);
  });
});

describe('domainParts', () => {
  it('extracts host and brand from URLs and bare domains', () => {
    expect(domainParts('https://www.solace.health/x')).toEqual({ host: 'solace.health', brand: 'solace' });
    expect(domainParts('monday.com')).toEqual({ host: 'monday.com', brand: 'monday' });
  });
  it('returns null for non-domains', () => {
    expect(domainParts('just text')).toBeNull();
    expect(domainParts('')).toBeNull();
  });
});
