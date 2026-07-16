/** Levenshtein edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] as number) + 1, // deletion
        (curr[j - 1] as number) + 1, // insertion
        (prev[j - 1] as number) + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] as number;
}

/** Normalized similarity in [0, 1]; 1 = identical. */
export function similarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

/**
 * Extract the registrable brand token from a domain or URL.
 * "https://www.solace.health/x" -> "solace"; "monday.com" -> "monday".
 * Returns the whole host label set for callers that want more.
 */
export function domainParts(input: string): { host: string; brand: string } | null {
  if (!input) return null;
  let host = input.trim().toLowerCase();
  host = host.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  if (!host.includes('.')) return null;
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return null;
  // Brand label = the label before the (public) suffix. Good enough for scoring.
  const brand = labels[labels.length - 2] as string;
  return { host, brand };
}
