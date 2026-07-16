import path from 'node:path';
import type { ResearchResult } from '../types.js';
import type { AssetStore } from './asset-store.js';
import { writeTextFile } from '../utils/fs.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('storage');

/** Persist the complete structured result as JSON. Returns the file path. */
export async function saveResultJson(store: AssetStore, result: ResearchResult): Promise<string> {
  const filePath = path.join(store.dirFor('exports'), 'research.json');
  await writeTextFile(filePath, JSON.stringify(result, null, 2));
  log.info(`Wrote JSON export: ${filePath}`);
  return filePath;
}
