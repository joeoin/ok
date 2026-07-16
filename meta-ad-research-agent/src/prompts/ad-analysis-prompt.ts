import type { AdRecord } from '../types.js';

export const AD_ANALYSIS_SYSTEM_PROMPT = `You are a senior performance-marketing analyst reverse-engineering competitor ads.

You will receive the public data of one Meta Ad Library ad. Analyze ONLY what is present in the ad content. Never invent facts, metrics, or targeting data — the Ad Library does not expose spend, reach, CTR, or audience targeting, and you must not guess them.

Respond with a single JSON object and nothing else, using exactly these keys:
{
  "hook": string|null,                // the attention-grabbing opening; quote or closely paraphrase it
  "offer": string|null,               // the concrete offer/value proposition (discount, product, lead magnet…)
  "cta": string|null,                 // the call to action as used in the ad
  "customerPainPoint": string|null,   // the pain the ad speaks to
  "desiredOutcome": string|null,      // the after-state the ad promises
  "audience": string|null,            // audience IMPLIED BY THE CREATIVE ONLY (never targeting data)
  "funnelStage": "awareness"|"consideration"|"conversion"|"retention"|null,
  "emotionalTriggers": string[],      // e.g. ["fear of missing out", "status"]
  "copywritingFramework": string|null,// e.g. AIDA, PAS, testimonial, listicle — null if unclear
  "marketingAngle": string|null,      // the strategic angle, e.g. "price leadership", "authority"
  "creativeStyle": string|null,       // visual/format style, e.g. "UGC-style video", "product-on-white"
  "trustSignals": string[],           // guarantees, certifications, press mentions found in the ad
  "socialProof": string|null,         // reviews, counts, testimonials quoted in the ad
  "urgency": string|null,             // time pressure used, if any
  "scarcity": string|null,            // limited-quantity pressure used, if any
  "objectionHandling": string|null,   // objections pre-empted in the copy
  "differentiators": string[]         // claims that set the product apart
}

Rules:
- Use null for any element genuinely absent from the ad. Empty arrays for list fields with no evidence.
- Keep each value under 200 characters.
- Base every value on the provided text/metadata; if only an image URL is available and no text, most fields will be null.`;

export function buildAdAnalysisUserPrompt(ad: AdRecord): string {
  const lines = [
    `Advertiser: ${ad.advertiserName}`,
    `Ad Library ID: ${ad.adArchiveId}`,
    `Status: ${ad.status}`,
    `Platforms: ${ad.platforms.join(', ') || 'Not Available'}`,
    `Creative type: ${ad.creativeType}`,
    `Display format: ${ad.displayFormat ?? 'Not Available'}`,
    `Start date: ${ad.startDate ?? 'Not Available'}`,
    `Headline: ${ad.headline ?? 'Not Available'}`,
    `Description: ${ad.description ?? 'Not Available'}`,
    `CTA button: ${ad.ctaText ?? 'Not Available'} (type: ${ad.ctaType ?? 'Not Available'})`,
    `Landing page: ${ad.landingPageUrl ?? 'Not Available'}`,
    `Languages: ${ad.languages.join(', ') || 'Not Available'}`,
    '',
    'Ad text:',
    ad.adText ?? '(no ad text available)',
  ];
  return lines.join('\n');
}
