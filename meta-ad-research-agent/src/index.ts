#!/usr/bin/env node
import { loadConfig } from './config.js';
import { runResearch } from './pipeline.js';
import { createLogger, setLogLevel } from './utils/logger.js';

const log = createLogger('main');

function usage(): never {
  console.log('Usage: npm run research -- "<company name>"');
  console.log('Example: npm run research -- "Nike"');
  process.exit(1);
}

async function main(): Promise<void> {
  const query = process.argv.slice(2).join(' ').trim();
  if (!query || query === '--help' || query === '-h') usage();

  const config = loadConfig();
  setLogLevel(config.logLevel);
  log.info(`Starting Meta Ad Library research for "${query}"`);

  const { result, files } = await runResearch(query, config);

  const analyzed = result.ads.filter((a) => a.analysis !== null).length;
  console.log('\n─ Research complete ─────────────────────────────');
  console.log(`Advertiser:   ${result.advertiser.name}`);
  console.log(`Ads collected: ${result.ads.length} (${analyzed} AI-analyzed)`);
  console.log(`CSV:          ${files.csv}`);
  console.log(`JSON:         ${files.json}`);
  console.log(`Report:       ${files.markdown}`);
  if (result.reportError) console.log(`Report note:  ${result.reportError}`);
}

main().catch((error) => {
  log.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
