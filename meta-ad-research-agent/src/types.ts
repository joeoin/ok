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
  /** Advertiser website/domain when exposed (e.g. "solace.health"). Optional. */
  website?: string | null;
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

/**
 * A group of near-identical ads collapsed into one distinct creative.
 * Meta commonly runs one creative across dozens of ad IDs (placement/audience
 * splits); counting ad IDs inflates apparent strategy ~50x. The Creative Group
 * is the real unit of analysis.
 */
export interface CreativeGroup {
  /** Deterministic id derived from the creative signature. */
  creativeId: string;
  /** Number of ad IDs collapsed into this creative. */
  duplicateCount: number;
  /** All ad archive IDs in this group. */
  adArchiveIds: string[];
  /** Representative ad used for display/analysis. */
  representative: AdRecord;
  headline: string | null;
  creativeType: CreativeType;
  firstSeen: string | null;
  lastSeen: string | null;
  /** Whole-number days between first and last seen, when both known. */
  estimatedRuntimeDays: number | null;
  countries: string[];
  languages: string[];
  platforms: string[];
  /** AI analysis of the representative creative (shared by the whole group). */
  analysis: AdAnalysis | null;
  analysisError: string | null;
}

/** 0–100 sub-scores describing how much to trust a report. */
export interface ReliabilityScores {
  /** Overall confidence (weighted blend of the sub-scores). */
  overall: number;
  /** Confidence the correct advertiser was identified. */
  advertiserConfidence: number;
  /** How complete the per-ad fields are (body copy, CTA, media, dates…). */
  dataCompleteness: number;
  /** How much of the advertiser's active-ad population was collected. */
  coverage: number;
  /** False when no verifiable population figure existed, so `coverage` is not meaningful. */
  coverageMeasured: boolean;
  /** Share of creatives with a usable creative asset (image/video/screenshot). */
  creativeCoverage: number;
  /** Human-readable explanations for anything that lowered the scores. */
  missingDataExplanations: string[];
  /** Where the data came from (API, scraper, or hybrid). */
  dataSource: string;
}

/**
 * Company-wide synthesis, structured as an executive briefing (14 sections,
 * in reading order). Every section must be grounded in observed creatives —
 * no generic marketing advice.
 */
export interface CompanyReport {
  executiveSummary: string;
  biggestStrategicInsight: string;
  companyPositioning: string;
  messagingStrategy: string;
  customerPsychology: string;
  creativeWinners: string;
  creativeBreakdown: string;
  hookDistribution: string;
  offerDistribution: string;
  funnelStrategy: string;
  competitiveWeaknesses: string;
  opportunities: string;
  counterStrategy: string;
  actionItems: string;
}

/** How the advertiser was resolved, for the report's reliability panel. */
export interface AdvertiserResolutionInfo {
  confidencePct: number;
  method: 'auto-accepted' | 'user-selected' | 'page-id';
  reasons: string[];
}

/**
 * Verifiable ad-volume figures. This type deliberately has no slot for an
 * unverifiable estimate: the Ad Library API's `estimated_total_count` is
 * ungrouped, explicitly approximate, and over-counts what the UI shows
 * (Solace: API 678 vs UI ~370), so it is NEVER stored or displayed as the
 * advertiser's ad count.
 */
export interface AdVolume {
  /** Ads we actually collected and counted. Fully verifiable. */
  collectedAds: number;
  /** Distinct creatives after dedup. Fully verifiable. */
  uniqueCreatives: number;
  /**
   * The Ad Library *UI's* own approximate result count, scraped from the page
   * ("~370 results"). Meta's figure, attributable and shown as approximate.
   * null when it could not be read. This is the ONLY population reference we
   * ever surface — never the API estimate.
   */
  metaReportedApprox: number | null;
  /** True only when we verified we captured Meta's entire reported set. */
  fullyCollected: boolean;
}

/** Everything a single research run produces. */
export interface ResearchResult {
  advertiser: AdvertiserPage;
  searchQuery: string;
  searchCountry: string;
  collectedAt: string;
  ads: AnalyzedAd[];
  /** Distinct creatives (deduped), ranked most-significant first. */
  creativeGroups: CreativeGroup[];
  report: CompanyReport | null;
  reportError: string | null;
  reliability: ReliabilityScores;
  advertiserResolution: AdvertiserResolutionInfo;
  /** Verifiable ad-volume figures (never the API's unverifiable estimate). */
  adVolume: AdVolume;
}
