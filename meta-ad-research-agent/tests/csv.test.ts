import { describe, expect, it } from 'vitest';
import { buildCsv, toCsvValue } from '../src/utils/csv.js';

describe('toCsvValue', () => {
  it('maps null/undefined to "Not Available"', () => {
    expect(toCsvValue(null)).toBe('Not Available');
    expect(toCsvValue(undefined)).toBe('Not Available');
  });

  it('joins arrays and maps empty arrays to "Not Available"', () => {
    expect(toCsvValue(['a', 'b'])).toBe('a; b');
    expect(toCsvValue([])).toBe('Not Available');
  });
});

describe('buildCsv', () => {
  it('escapes quotes, commas, and newlines per RFC 4180', () => {
    const csv = buildCsv(['a', 'b'], [{ a: 'say "hi", ok?', b: 'line1\nline2' }]);
    expect(csv).toBe('a,b\r\n"say ""hi"", ok?","line1\nline2"\r\n');
  });

  it('keeps column order and fills missing keys', () => {
    const csv = buildCsv(['x', 'y'], [{ y: '2' }]);
    expect(csv.split('\r\n')[1]).toBe('Not Available,2');
  });
});
