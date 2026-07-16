import type { AdvertiserPage, AnalyzedAd } from '../types.js';

export const COMPANY_REPORT_SYSTEM_PROMPT = `You are a senior marketing strategist writing a competitor research report from Meta Ad Library data.

You will receive structured summaries of every active ad an advertiser is currently running. Synthesize them into a company-wide analysis.

Ground every claim in the provided ads. Never invent spend, performance metrics, or targeting data — the Ad Library does not expose them. Where the data is too thin to support a section, write "Not enough public data to assess."

Respond with a single JSON object and nothing else, using exactly these keys (each value is a Markdown-formatted string of 1-4 paragraphs or a bullet list):
{
  "executiveSummary": string,
  "messagingStrategy": string,
  "brandPositioning": string,
  "primaryOffers": string,
  "recurringHooks": string,
  "creativeTrends": string,
  "audienceStrategy": string,
  "funnelStrategy": string,
  "copywritingPatterns": string,
  "ctaAnalysis": string,
  "strengths": string,
  "weaknesses": string,
  "potentialOpportunities": string,
  "recommendations": string
}`;

/**
 * Compact per-ad digest for the synthesis prompt. Keeps token usage bounded
 * even for large ad sets by truncating copy and capping the ad count.
 */
export function buildCompanyReportUserPrompt(
  advertiser: AdvertiserPage,
  ads: AnalyzedAd[],
  maxAdsInPrompt = 150,
): string {
  const digest = ads.slice(0, maxAdsInPrompt).map(({ ad, analysis }, i) => {
    const parts: string[] = [
      `--- Ad ${i + 1} (ID ${ad.adArchiveId}) ---`,
      `type=${ad.creativeType} platforms=${ad.platforms.join('/') || '?'} start=${ad.startDate ?? '?'} cta=${ad.ctaText ?? '?'}`,
      `text: ${(ad.adText ?? '').slice(0, 400) || '(none)'}`,
    ];
    if (ad.headline) parts.push(`headline: ${ad.headline.slice(0, 150)}`);
    if (analysis) {
      const a = analysis;
      parts.push(
        `analysis: hook=${a.hook ?? '-'} | offer=${a.offer ?? '-'} | angle=${a.marketingAngle ?? '-'} | ` +
          `funnel=${a.funnelStage ?? '-'} | audience=${a.audience ?? '-'} | framework=${a.copywritingFramework ?? '-'} | ` +
          `triggers=${a.emotionalTriggers.join(',') || '-'}`,
      );
    }
    return parts.join('\n');
  });

  const omitted = ads.length - Math.min(ads.length, maxAdsInPrompt);
  return [
    `Advertiser: ${advertiser.name} (page ID ${advertiser.pageId})`,
    `Category: ${advertiser.category ?? 'Not Available'}`,
    `Total active ads collected: ${ads.length}${omitted > 0 ? ` (${omitted} omitted from this digest for length)` : ''}`,
    '',
    ...digest,
  ].join('\n');
}
