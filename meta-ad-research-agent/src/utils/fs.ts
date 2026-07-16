import fs from 'node:fs/promises';
import path from 'node:path';

/** Filesystem-safe slug for advertiser names: "Acme Solar!" -> "acme-solar". */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'advertiser';
}

export async function ensureDir(dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, 'utf8');
}

export async function writeBinaryFile(filePath: string, content: Buffer): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content);
}

/** Timestamp suitable for folder names: 2026-07-16T10-30-00 */
export function runTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace(/\.\d+Z$/, '').replaceAll(':', '-');
}
