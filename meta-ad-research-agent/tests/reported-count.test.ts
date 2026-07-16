import { describe, expect, it } from 'vitest';
import { parseReportedResultCount } from '../src/scraper/ad-library-scraper.js';

describe('parseReportedResultCount', () => {
  it('parses the common "~N results" forms', () => {
    expect(parseReportedResultCount('~370 results')).toBe(370);
    expect(parseReportedResultCount('About 1,234 results')).toBe(1234);
    expect(parseReportedResultCount('370 results')).toBe(370);
    expect(parseReportedResultCount('1 result')).toBe(1);
  });

  it('finds the count inside surrounding UI text', () => {
    expect(parseReportedResultCount('Filters\n~370 results\nSort by')).toBe(370);
  });

  it('returns null when no count is present', () => {
    expect(parseReportedResultCount('No ads to show')).toBeNull();
    expect(parseReportedResultCount('')).toBeNull();
    // Must NOT pick up unrelated numbers that are not a result count.
    expect(parseReportedResultCount('Library ID: 1234567890')).toBeNull();
  });
});
