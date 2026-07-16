import type { AdvertiserPage, CompanyReport, CreativeGroup } from '../types.js';
import type { LlmClient } from '../analyzer/llm-client.js';
import type { Aggregates } from '../analyzer/aggregate.js';
import { companyReportSchema, extractJsonObject } from '../analyzer/schemas.js';
import {
  COMPANY_REPORT_SYSTEM_PROMPT,
  buildCompanyReportUserPrompt,
} from '../prompts/company-report-prompt.js';
import { withRetry } from '../utils/retry.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('report');

export interface ReportOutcome {
  report: CompanyReport | null;
  error: string | null;
}

/** Synthesize the executive briefing from deduplicated creatives + aggregates. */
export async function generateCompanyReport(
  llm: LlmClient | null,
  advertiser: AdvertiserPage,
  groups: CreativeGroup[],
  aggregates: Aggregates,
  metaReportedApprox: number | null,
): Promise<ReportOutcome> {
  if (!llm) return { report: null, error: 'Report generation disabled (LLM_PROVIDER=none)' };
  if (groups.length === 0) return { report: null, error: 'No creatives collected — nothing to report on' };

  try {
    log.info('Generating executive briefing…');
    const report = await withRetry(
      async () => {
        const raw = await llm.complete({
          system: COMPANY_REPORT_SYSTEM_PROMPT,
          user: buildCompanyReportUserPrompt(advertiser, groups, aggregates, metaReportedApprox),
          json: true,
          maxTokens: 4000,
        });
        return companyReportSchema.parse(extractJsonObject(raw));
      },
      { attempts: 2, baseDelayMs: 1000 },
    );
    return { report, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Company report generation failed: ${message.slice(0, 300)}`);
    return { report: null, error: message };
  }
}
