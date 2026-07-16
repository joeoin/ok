import { z } from 'zod';
import type { AdAnalysis, CompanyReport } from '../types.js';

/**
 * Tolerant coercions: LLMs occasionally return "" or "N/A" where we want
 * null, or a comma string where we want an array. Normalizing here keeps the
 * analyzer simple and the output consistent.
 */
const nullableString = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null) return null;
    const t = v.trim();
    return t === '' || /^(n\/?a|not available|none|unknown)$/i.test(t) ? null : t;
  });

const stringArray = z
  .union([z.array(z.string()), z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null) return [];
    const arr = Array.isArray(v) ? v : v.split(',');
    return arr.map((s) => s.trim()).filter((s) => s !== '' && !/^(n\/?a|none)$/i.test(s));
  });

const funnelStage = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    const t = v?.trim().toLowerCase() ?? '';
    return (['awareness', 'consideration', 'conversion', 'retention'] as const).find((s) => t.includes(s)) ?? null;
  });

export const adAnalysisSchema = z.object({
  hook: nullableString,
  offer: nullableString,
  cta: nullableString,
  customerPainPoint: nullableString,
  desiredOutcome: nullableString,
  audience: nullableString,
  funnelStage,
  emotionalTriggers: stringArray,
  copywritingFramework: nullableString,
  marketingAngle: nullableString,
  creativeStyle: nullableString,
  trustSignals: stringArray,
  socialProof: nullableString,
  urgency: nullableString,
  scarcity: nullableString,
  objectionHandling: nullableString,
  differentiators: stringArray,
}) satisfies z.ZodType<AdAnalysis, z.ZodTypeDef, unknown>;

const reportSection = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => v?.trim() || 'Not Available');

export const companyReportSchema = z.object({
  executiveSummary: reportSection,
  messagingStrategy: reportSection,
  brandPositioning: reportSection,
  primaryOffers: reportSection,
  recurringHooks: reportSection,
  creativeTrends: reportSection,
  audienceStrategy: reportSection,
  funnelStrategy: reportSection,
  copywritingPatterns: reportSection,
  ctaAnalysis: reportSection,
  strengths: reportSection,
  weaknesses: reportSection,
  potentialOpportunities: reportSection,
  recommendations: reportSection,
}) satisfies z.ZodType<CompanyReport, z.ZodTypeDef, unknown>;

/**
 * Extract the first JSON object from an LLM reply that may wrap it in prose
 * or a ```json fence.
 */
export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in LLM response');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}
