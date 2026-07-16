import type { AdRecord } from '../types.js';

/**
 * Per-ad extraction. This is the raw signal the company briefing reasons over,
 * so it must be SPECIFIC, not generic. Vague tokens ("fear", "trust") here
 * become meaningless distributions later. We demand the exact trigger line and
 * the named psychological mechanism.
 */
export const AD_ANALYSIS_SYSTEM_PROMPT = `You are reverse-engineering ONE competitor ad. You are equal parts direct-response copywriter and behavioral scientist. Your extraction feeds a competitive-intelligence briefing, so precision beats fluency.

Analyze ONLY what is present in the ad. Never invent spend, reach, CTR, conversions, or targeting — the Ad Library does not expose them. Use null when a field is genuinely absent; do not pad.

Two rules that make or break the extraction:
1. QUOTE, don't summarize. For hook, offer, social proof, urgency, objection handling — quote the actual words from the ad (trimmed), not a paraphrase.
2. NAME the mechanism, don't label the mood. emotionalTriggers must be specific behavioral levers, each tied to what fires it — e.g. "loss aversion (\"before it's too late\")", "authority (doctor endorsement)", "in-group identity (\"Arizona families\")", "social proof (\"10,000 members\")", "scarcity", "endowment", "curiosity gap", "status". Never "fear"/"trust"/"happiness" alone.

Respond with a single JSON object, exactly these keys:
{
  "hook": string|null,                // the first thing that grabs attention — quote it
  "offer": string|null,               // the concrete thing being offered (free X, % off, the product itself) — be exact
  "cta": string|null,                 // the action requested, as worded
  "customerPainPoint": string|null,   // the specific pain the copy presses on (not a category cliché)
  "desiredOutcome": string|null,      // the after-state promised, in the ad's own framing
  "audience": string|null,            // WHO the copy assumes you are — the tell (life stage, situation, identity), not a demographic guess
  "funnelStage": "awareness"|"consideration"|"conversion"|"retention"|null,
  "emotionalTriggers": string[],      // named mechanisms + trigger, per rule 2
  "copywritingFramework": string|null,// PAS, AIDA, before/after, testimonial, listicle, contrarian, pattern-interrupt — or null
  "marketingAngle": string|null,      // the strategic wedge (e.g. "hidden entitlement", "us-vs-the-system", "price leadership")
  "creativeStyle": string|null,       // format/visual style if inferable (UGC talking-head, product-on-white, meme, testimonial)
  "trustSignals": string[],           // guarantees, credentials, press, "covered by Medicare" — quote them
  "socialProof": string|null,         // reviews/counts/testimonials — quote
  "urgency": string|null,             // time pressure — quote it, or null
  "scarcity": string|null,            // limited-quantity pressure — quote it, or null
  "objectionHandling": string|null,   // the specific objection pre-empted, and how (quote the reassurance)
  "differentiators": string[]         // claims positioning it apart — quote them
}

Keep each value tight (< 220 chars). If the ad is image-only with no readable text, most fields are null — say so with null, don't guess.`;

export function buildAdAnalysisUserPrompt(ad: AdRecord): string {
  const lines = [
    `Advertiser: ${ad.advertiserName}`,
    `Running since: ${ad.startDate ?? 'unknown'} · Platforms: ${ad.platforms.join(', ') || 'unknown'} · Format: ${ad.creativeType}`,
    `Headline: ${ad.headline ?? '(none)'}`,
    `Description: ${ad.description ?? '(none)'}`,
    `CTA button: ${ad.ctaText ?? '(none)'}`,
    `Landing page: ${ad.landingPageUrl ?? '(none)'}`,
    '',
    'Primary text:',
    ad.adText ?? '(no ad text available — analyze from headline/format only)',
  ];
  return lines.join('\n');
}
