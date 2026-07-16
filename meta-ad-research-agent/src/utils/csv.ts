/**
 * Minimal RFC 4180 CSV writer. Kept dependency-free and unit-tested rather
 * than pulling in a library for one export path.
 */

function escapeCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return '"' + value.replaceAll('"', '""') + '"';
  }
  return value;
}

export function toCsvValue(value: unknown): string {
  if (value === null || value === undefined) return 'Not Available';
  if (Array.isArray(value)) return value.length ? value.join('; ') : 'Not Available';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/** Serialize rows (in `columns` order) to a CSV string with a header line. */
export function buildCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const header = columns.map(escapeCell).join(',');
  const lines = rows.map((row) => columns.map((col) => escapeCell(toCsvValue(row[col]))).join(','));
  return [header, ...lines].join('\r\n') + '\r\n';
}
