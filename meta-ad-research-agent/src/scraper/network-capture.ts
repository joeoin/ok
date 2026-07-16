import type { Page, Response } from 'playwright';
import { createLogger } from '../utils/logger.js';

const log = createLogger('network');

/**
 * Attaches to a page and collects every JSON-ish payload the Ad Library
 * loads. The Ad Library has shipped several data channels over time
 * (async/search_ads, api/graphql) and rotates between them; instead of
 * pinning one endpoint we capture any response that parses as JSON and let
 * the parser layer find ad-shaped objects inside.
 */
export class NetworkCapture {
  private payloads: unknown[] = [];
  private handler: ((response: Response) => Promise<void>) | null = null;
  private urlFilter: RegExp;

  constructor(urlFilter: RegExp = /facebook\.com\/(api\/graphql|ads\/library\/async)/) {
    this.urlFilter = urlFilter;
  }

  attach(page: Page): void {
    this.handler = async (response: Response) => {
      try {
        const url = response.url();
        if (!this.urlFilter.test(url)) return;
        if (response.request().resourceType() !== 'xhr' && response.request().resourceType() !== 'fetch') return;
        const body = await response.text();
        for (const payload of parseFacebookJsonBody(body)) {
          this.payloads.push(payload);
        }
      } catch {
        // Responses can be disposed by navigation before we read them; skip.
      }
    };
    page.on('response', this.handler);
  }

  detach(page: Page): void {
    if (this.handler) page.off('response', this.handler);
    this.handler = null;
  }

  /** Drain everything captured so far (clears the internal buffer). */
  drain(): unknown[] {
    const out = this.payloads;
    this.payloads = [];
    return out;
  }

  get count(): number {
    return this.payloads.length;
  }
}

/**
 * Facebook JSON responses come in three flavors:
 *  1. plain JSON
 *  2. JSON prefixed with the XSSI guard `for (;;);`
 *  3. newline-delimited JSON chunks (GraphQL streamed responses)
 * Returns every object that parses.
 */
export function parseFacebookJsonBody(body: string): unknown[] {
  const stripped = body.startsWith('for (;;);') ? body.slice('for (;;);'.length) : body;
  const results: unknown[] = [];

  const tryParse = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return;
    try {
      results.push(JSON.parse(trimmed));
    } catch {
      // Not valid JSON — ignore this chunk.
    }
  };

  tryParse(stripped);
  if (results.length === 0 && stripped.includes('\n')) {
    for (const line of stripped.split('\n')) tryParse(line);
  }
  if (results.length === 0) log.debug('Response body did not parse as JSON');
  return results;
}
