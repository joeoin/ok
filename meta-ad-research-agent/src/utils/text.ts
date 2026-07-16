/** Shared text-normalization helpers used by slugging and name matching. */

/** Remove combining diacritical marks (é -> e) after NFKD normalization. */
export function stripDiacritics(input: string): string {
  return input.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

/** Lowercase, strip diacritics, reduce to single-spaced alphanumeric tokens. */
export function normalizeText(input: string): string {
  return stripDiacritics(input.toLowerCase())
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
