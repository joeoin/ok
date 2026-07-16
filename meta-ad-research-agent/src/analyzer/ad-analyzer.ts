import type { AdRecord, AnalyzedAd } from '../types.js';
import type { LlmClient } from './llm-client.js';
import { adAnalysisSchema, extractJsonObject } from './schemas.js';
import { AD_ANALYSIS_SYSTEM_PROMPT, buildAdAnalysisUserPrompt } from '../prompts/ad-analysis-prompt.js';
import { mapWithConcurrency } from '../utils/concurrency.js';
import { withRetry } from '../utils/retry.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('analyzer');

/**
 * Runs every ad through the LLM and validates the structured result.
 * Failures are captured per-ad (analysis=null + error message) so one bad
 * response never aborts the run.
 */
export class AdAnalyzer {
  constructor(
    private readonly llm: LlmClient | null,
    private readonly concurrency: number,
  ) {}

  async analyzeAll(ads: AdRecord[]): Promise<AnalyzedAd[]> {
    if (!this.llm) {
      log.warn('LLM_PROVIDER=none — skipping AI analysis');
      return ads.map((ad) => ({ ad, analysis: null, analysisError: 'Analysis disabled (LLM_PROVIDER=none)' }));
    }

    log.info(`Analyzing ${ads.length} ads with ${this.llm.name} (concurrency ${this.concurrency})`);
    let done = 0;
    return mapWithConcurrency(ads, this.concurrency, async (ad) => {
      const result = await this.analyzeOne(ad);
      done++;
      if (done % 10 === 0 || done === ads.length) log.info(`Analyzed ${done}/${ads.length} ads`);
      return result;
    });
  }

  private async analyzeOne(ad: AdRecord): Promise<AnalyzedAd> {
    try {
      const analysis = await withRetry(
        async () => {
          const raw = await this.llm!.complete({
            system: AD_ANALYSIS_SYSTEM_PROMPT,
            user: buildAdAnalysisUserPrompt(ad),
            json: true,
          });
          // Parse + validate; throwing here triggers a retry with a fresh completion.
          return adAnalysisSchema.parse(extractJsonObject(raw));
        },
        { attempts: 2, baseDelayMs: 500 },
      );
      return { ad, analysis, analysisError: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`Analysis failed for ad ${ad.adArchiveId}: ${message.slice(0, 200)}`);
      return { ad, analysis: null, analysisError: message };
    }
  }
}
