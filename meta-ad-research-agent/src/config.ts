import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const boolFromEnv = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : !['false', '0', 'no'].includes(v.toLowerCase())));

const intFromEnv = (def: number, min = 0) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number.parseInt(v, 10)))
    .pipe(z.number().int().min(min));

const configSchema = z.object({
  LLM_PROVIDER: z.enum(['openai', 'anthropic', 'none']).default('openai'),
  LLM_API_KEY: z.string().default(''),
  LLM_BASE_URL: z.string().default(''),
  LLM_MODEL: z.string().default('gpt-4o-mini'),
  LLM_CONCURRENCY: intFromEnv(3, 1),
  HEADLESS: boolFromEnv(true),
  CHROMIUM_PATH: z.string().default(''),
  AD_LIBRARY_COUNTRY: z.string().default('ALL'),
  MAX_ADS: intFromEnv(100, 0),
  TIMEOUT_MS: intFromEnv(30_000, 1_000),
  SCROLL_IDLE_MS: intFromEnv(8_000, 1_000),
  OUTPUT_DIR: z.string().default('.'),
  SCREENSHOTS: boolFromEnv(true),
  DOWNLOAD_IMAGES: boolFromEnv(true),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export interface AppConfig {
  llm: {
    provider: 'openai' | 'anthropic' | 'none';
    apiKey: string;
    baseUrl: string;
    model: string;
    concurrency: number;
  };
  scraper: {
    headless: boolean;
    chromiumPath: string;
    country: string;
    maxAds: number;
    timeoutMs: number;
    scrollIdleMs: number;
  };
  output: {
    rootDir: string;
    screenshots: boolean;
    downloadImages: boolean;
  };
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
};

/** Load and validate configuration from process.env (.env is auto-loaded). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const c = parsed.data;

  return {
    llm: {
      provider: c.LLM_PROVIDER,
      apiKey: c.LLM_API_KEY,
      baseUrl: c.LLM_BASE_URL || DEFAULT_BASE_URLS[c.LLM_PROVIDER] || '',
      model: c.LLM_MODEL,
      concurrency: c.LLM_CONCURRENCY,
    },
    scraper: {
      headless: c.HEADLESS,
      chromiumPath: c.CHROMIUM_PATH,
      country: c.AD_LIBRARY_COUNTRY.toUpperCase(),
      maxAds: c.MAX_ADS,
      timeoutMs: c.TIMEOUT_MS,
      scrollIdleMs: c.SCROLL_IDLE_MS,
    },
    output: {
      rootDir: path.resolve(c.OUTPUT_DIR),
      screenshots: c.SCREENSHOTS,
      downloadImages: c.DOWNLOAD_IMAGES,
    },
    logLevel: c.LOG_LEVEL,
  };
}
