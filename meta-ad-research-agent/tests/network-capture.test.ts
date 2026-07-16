import { describe, expect, it } from 'vitest';
import { parseFacebookJsonBody } from '../src/scraper/network-capture.js';

describe('parseFacebookJsonBody', () => {
  it('parses plain JSON', () => {
    expect(parseFacebookJsonBody('{"a":1}')).toEqual([{ a: 1 }]);
  });

  it('strips the XSSI guard prefix', () => {
    expect(parseFacebookJsonBody('for (;;);{"a":1}')).toEqual([{ a: 1 }]);
  });

  it('parses newline-delimited GraphQL chunks', () => {
    const body = '{"data":{"x":1}\n invalid \n{"data":{"y":2}}';
    const parsed = parseFacebookJsonBody(body);
    expect(parsed).toEqual([{ data: { y: 2 } }]);
  });

  it('returns empty for non-JSON bodies', () => {
    expect(parseFacebookJsonBody('<html></html>')).toEqual([]);
  });
});
