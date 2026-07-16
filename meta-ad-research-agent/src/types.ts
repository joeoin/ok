/**
 * Core domain types shared across the pipeline.
 *
 * Every field that the Meta Ad Library may not expose is nullable. The string
 * literal "Not Available" is only introduced at export time (CSV/Markdown);
 * internally we keep proper nulls.
 */

/** An advertiser page as surfaced by the Ad Library typeahead / search. */
export interface AdvertiserPage {
  pageId: string;
  name: string;
  category: string | null;
  likes: number | null;
  verification: string | null;
  imageUri: string | null;
  /** ISO country of the page, when exposed. */
  country: string | null;
}

export type CreativeType = 'image' | 'video' | 'carousel' | 'text' | 'unknown';

/** A single creative asset attached to an ad (one card of a carousel, etc.). */
export interface CreativeAsset {
  type: 'image' | 'video';
  /** Public CDN URL, when exposed. */
  url: string | null;
  /** Preview/thumbnail URL for videos. */
  previewUrl: string | null;
  /** Local path after download, relative to the run's output root. */
  localPath: string | null;
}

/** One advertisement, normalized from the Ad Library's raw payloads. */
export interface AdRecord {
  /** Ad Library ID ("Library ID" in the UI). Stable, public identifier. */
  adArchiveId: string;
  advertiserName: string;
  pageId: string;
  status: 'active' | 'inactive' | 'unknown';
  /** Publisher platforms, e.g. ["facebook", "instagram"]. */
  platforms: string[];
  /** Primary ad copy (body text). */
  adText: string | null;
  headline: string | null;
  description: string | null;
  /** Call-to-action button label, e.g. "Shop Now". */
  ctaText: string | null;
  /** CTA type token from the payload, e.g. SHOP_NOW. */
  ctaType: string | null;
  landingPageUrl: string | null;
  displayFormat: string | null;
  creativeType: CreativeType;
  assets: CreativeAsset[];
  /** ISO date (YYYY-MM-DD) the ad started delivery, when exposed. */
  startDate: string | null;
  /** ISO date the ad stopped delivery; null for active ads. */
  endDate: string | null;
  /** Countries the search was scoped to (Ad Library doesn't expose targeting). */
  searchCountry: string;
  /** BCP-47-ish language tags detected in the creative, when exposed. */
  languages: string[];
  /** Number of near-duplicate ads Meta collated under this one, when exposed. */
  collationCount: number | null;
  /** Deep link to the ad in the Ad Library. */
  adLibraryUrl: string;
  /** Local screenshot path relative to the run's output root, if captured. */
  screenshotPath: string | null;
}

/** Structured AI analysis of one ad. All fields nullable — never fabricated. */
export interface AdAnalysis {
  hook: string | null;
  offer: string | null;
  cta: string | null;
  customerPainPoint: string | null;
  desiredOutcome: string | null;
  audience: string | null;
  funnelStage: 'awareness' | 'consideration' | 'conversion' | 'retention' | null;
  emotionalTriggers: string[];
  copywritingFramework: string | null;
  marketingAngle: string | null;
  creativeStyle: string | null;
  trustSignals: string[];
  socialProof: string | null;
  urgency: string | null;
  scarcity: string | null;
  objectionHandling: string | null;
  differentiators: string[];
}

export interface AnalyzedAd {
  ad: AdRecord;
  /** Null when analysis was skipped (LLM_PROVIDER=none) or failed after retries. */
  analysis: AdAnalysis | null;
  analysisError: string | null;
}

/** Company-wide synthesis produced from all analyzed ads. */
export interface CompanyReport {
  executiveSummary: string;
  messagingStrategy: string;
  brandPositioning: string;
  primaryOffers: string;
  recurringHooks: string;
  creativeTrends: string;
  audienceStrategy: string;
  funnelStrategy: string;
  copywritingPatterns: string;
  ctaAnalysis: string;
  strengths: string;
  weaknesses: string;
  potentialOpportunities: string;
  recommendations: string;
}

/** Everything a single research run produces. */
export interface ResearchResult {
  advertiser: AdvertiserPage;
  searchQuery: string;
  searchCountry: string;
  collectedAt: string;
  ads: AnalyzedAd[];
  report: CompanyReport | null;
  reportError: string | null;
}
