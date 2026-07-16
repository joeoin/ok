import type { AdvertiserPage, CreativeGroup } from '../types.js';
import type { Aggregates } from '../analyzer/aggregate.js';

export const COMPANY_REPORT_SYSTEM_PROMPT = `You are a senior strategy consultant (think McKinsey / Bain / BCG) writing a competitive-intelligence briefing from Meta Ad Library data.

You receive DEDUPLICATED creatives (not raw ad IDs) with volume weights, plus pre-computed distributions. Write an executive briefing that a CMO would trust and a media buyer would act on.

HARD RULES — violating any of these makes the report worthless:
- Ground EVERY claim in the provided creatives/numbers. Cite specifics (a hook line, a creative's duplicate count, a runtime, a distribution %). If you name a "winner", justify it with duplication or longevity from the data.
- NO generic marketing advice. Every recommendation must reference an actual observation ("They repeat X in N% of ads and never address Y, so attack Z").
- Never invent spend, reach, CTR, conversions, ROAS, or audience targeting — the Ad Library does not expose them. If something can't be determined, say "Not determinable from public data" and move on.
- Signal over volume: lead with the single most important insight; cut filler.

Explicitly answer, across the sections: What is this company trying to accomplish? Why these creatives? What customer psychology are they exploiting? What objections are they overcoming? What messaging repeats? What appears to be winning (and why)? What appears to be failing or absent? If I competed against them tomorrow, exactly how would I attack them?

Respond with a single JSON object and nothing else, using EXACTLY these keys (each a Markdown string, tight and specific):
{
  "executiveSummary": string,           // 3-5 sentences: the whole picture
  "biggestStrategicInsight": string,    // the one non-obvious thing worth the report's price
  "companyPositioning": string,
  "messagingStrategy": string,
  "customerPsychology": string,         // pains, desires, emotional triggers being exploited
  "creativeWinners": string,            // which creatives lead and WHY (duplication/longevity)
  "creativeBreakdown": string,          // formats, themes, what's being tested
  "hookDistribution": string,           // interpret the hook numbers provided
  "offerDistribution": string,          // interpret the offer numbers provided
  "funnelStrategy": string,             // awareness/consideration/conversion/retention mix + reading
  "competitiveWeaknesses": string,      // gaps, unaddressed objections, over-reliance
  "opportunities": string,              // whitespace an attacker could take
  "counterStrategy": string,            // "If I competed tomorrow" — concrete plays tied to observations
  "actionItems": string                 // a prioritized, numbered checklist
}`;

const truncate = (s: string | null, n: number): string => (s ? (s.length > n ? s.slice(0, n) + '…' : s) : '');

function dist(label: string, items: { label: string; ads: number; creatives: number; adSharePct: number }[]): string {
  if (items.length === 0) return `${label}: (none determinable)`;
  const top = items.slice(0, 8).map((d) => `${d.label} — ${d.ads} ads / ${d.creatives} creatives (${d.adSharePct}%)`);
  return `${label}:\n  ${top.join('\n  ')}`;
}

/**
 * Compact, deduplicated digest for the synthesis prompt. Feeds the model real
 * numbers (volume, runtime, distributions) so it grounds every claim.
 */
export function buildCompanyReportUserPrompt(
  advertiser: AdvertiserPage,
  groups: CreativeGroup[],
  aggregates: Aggregates,
  metaReportedApprox: number | null,
  maxCreativesInPrompt = 60,
): string {
  const shown = groups.slice(0, maxCreativesInPrompt);
  const digest = shown.map((g, i) => {
    const a = g.analysis;
    const parts = [
      `#${i + 1} [${g.duplicateCount} ads, ${g.creativeType}, runtime ${g.estimatedRuntimeDays ?? '?'}d, platforms ${g.platforms.join('/') || '?'}]`,
      `headline: ${truncate(g.headline, 140) || '(none)'}`,
    ];
    if (g.representative.adText) parts.push(`text: ${truncate(g.representative.adText, 300)}`);
    if (g.representative.ctaText) parts.push(`cta: ${g.representative.ctaText}`);
    if (a) {
      parts.push(
        `analysis: hook=${a.hook ?? '-'} | offer=${a.offer ?? '-'} | angle=${a.marketingAngle ?? '-'} | ` +
          `funnel=${a.funnelStage ?? '-'} | pain=${a.customerPainPoint ?? '-'} | triggers=${a.emotionalTriggers.join(',') || '-'}`,
      );
    }
    return parts.join('\n   ');
  });

  const omitted = groups.length - shown.length;
  return [
    `Advertiser: ${advertiser.name} (page ${advertiser.pageId})`,
    `Category: ${advertiser.category ?? 'Not Available'}`,
    `Ads collected: ${aggregates.totalAds} → ${aggregates.uniqueCreatives} unique creatives (both verified by direct count).` +
      (metaReportedApprox ? ` Meta's Ad Library UI reports ≈${metaReportedApprox} results for this page (Meta's own approximate figure).` : '') +
      ' Do not state any other total ad count; if you cite scale, use only these verified numbers.',
    '',
    'DISTRIBUTIONS (volume-weighted):',
    dist('Hooks', aggregates.hooks),
    dist('Offers', aggregates.offers),
    dist('Funnel stages', aggregates.funnelStages),
    dist('Formats', aggregates.formats),
    dist('CTAs', aggregates.ctas),
    '',
    `Longest-running creatives (proven-winner signal): ${
      aggregates.longestRunning.map((g) => `"${truncate(g.headline, 40)}" ${g.estimatedRuntimeDays}d`).join('; ') || 'unknown'
    }`,
    '',
    `DEDUPLICATED CREATIVES${omitted > 0 ? ` (top ${shown.length}; ${omitted} more omitted)` : ''}:`,
    ...digest,
  ].join('\n');
}
