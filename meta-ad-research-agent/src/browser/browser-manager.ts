import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createLogger } from '../utils/logger.js';

const log = createLogger('browser');

export interface BrowserOptions {
  headless: boolean;
  timeoutMs: number;
  /** Use a specific Chromium binary instead of Playwright's managed one. */
  executablePath?: string;
}

/**
 * Owns the Playwright browser lifecycle. One context per run keeps cookies
 * (e.g. the Ad Library's consent state) consistent across pages.
 */
export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  constructor(private readonly options: BrowserOptions) {}

  async start(): Promise<void> {
    log.info(`Launching Chromium (headless=${this.options.headless})`);
    this.browser = await chromium.launch({
      headless: this.options.headless,
      executablePath: this.options.executablePath || undefined,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1440, height: 1600 },
      locale: 'en-US',
      timezoneId: 'UTC',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    this.context.setDefaultTimeout(this.options.timeoutMs);
    this.context.setDefaultNavigationTimeout(this.options.timeoutMs);
  }

  async newPage(): Promise<Page> {
    if (!this.context) throw new Error('BrowserManager not started');
    return this.context.newPage();
  }

  getContext(): BrowserContext {
    if (!this.context) throw new Error('BrowserManager not started');
    return this.context;
  }

  async stop(): Promise<void> {
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.context = null;
    this.browser = null;
    log.info('Browser closed');
  }
}
