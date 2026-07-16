#!/usr/bin/env node
import path from 'node:path';
import { loadConfig } from './config.js';
import { runResearch } from './pipeline.js';
import { JsonFileAdvertiserCache } from './resolver/advertiser-cache.js';
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

  // Historical advertiser cache: confirmed resolutions persist across runs.
  const cache = await JsonFileAdvertiserCache.load(path.join(config.output.rootDir, 'config', 'advertiser-cache.json'));

  const { result, files } = await runResearch(query, config, { cache });
  await cache.persist().catch((e) => log.warn(`Could not persist advertiser cache: ${String(e)}`));

  const r = result.reliability;
  const analyzed = result.ads.filter((a) => a.analysis !== null).length;
  console.log('\n─ Research complete ─────────────────────────────');
  console.log(`Advertiser:    ${result.advertiser.name} (${result.advertiserResolution.confidencePct}% confidence, ${result.advertiserResolution.method})`);
  console.log(`Ads → creatives: ${result.ads.length} ads → ${result.creativeGroups.length} unique creatives (${analyzed} AI-analyzed)`);
  console.log(`Reliability:   ${r.overall}/100 overall · completeness ${r.dataCompleteness} · coverage ${r.coverage} · creatives ${r.creativeCoverage}`);
  console.log(`CSV:           ${files.csv}`);
  console.log(`JSON:          ${files.json}`);
  console.log(`Report:        ${files.markdown}`);
  if (result.reportError) console.log(`Report note:   ${result.reportError}`);
}

main().catch((error) => {
  log.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
