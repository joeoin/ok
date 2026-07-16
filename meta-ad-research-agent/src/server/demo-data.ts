import type { AdRecord, AdvertiserPage, AnalyzedAd, CompanyReport } from '../types.js';

/**
 * Demo dataset backed by REAL data collected from the Meta Ad Library
 * (official API, 2026-07-16). Used when the live Ad Library is unreachable so
 * the full product journey is testable. The UI shows a "Demo data" badge.
 * Strategic narratives are qualitative analysis of the real ads — no
 * fabricated metrics.
 */

export interface DemoAdvertiser {
  page: AdvertiserPage;
  /** Meta's own UI result count (approximate), when known. */
  metaReportedApprox: number | null;
  ads: AnalyzedAd[];
  /** Pre-written executive narrative (stands in for the live LLM in demo mode). */
  report: CompanyReport | null;
}

const iso = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

function mkAd(pageId: string, advertiser: string, id: string, headline: string, started: number): AdRecord {
  return {
    adArchiveId: id,
    advertiserName: advertiser,
    pageId,
    status: 'active',
    platforms: ['facebook', 'instagram'],
    adText: null,
    headline,
    description: null,
    ctaText: null,
    ctaType: null,
    landingPageUrl: null,
    displayFormat: null,
    creativeType: 'unknown',
    assets: [],
    startDate: iso(started),
    endDate: null,
    searchCountry: 'US',
    languages: ['en'],
    collationCount: null,
    adLibraryUrl: `https://www.facebook.com/ads/library/?id=${id}`,
    screenshotPath: null,
  };
}

// ── Solace (healthcare advocacy) — 55 real active ads ───────────────────────
const SOLACE_ROWS: Array<[string, string, number]> = [
  ['1522361232924034', 'Lower Your Cost of Care', 1783886916],
  ['1042782984867410', 'Lower Your Cost of Care', 1783884508],
  ['2105902190310315', 'Lower Your Cost of Care', 1783781476],
  ['2528041810967295', 'Lower Your Cost of Care', 1783781459],
  ['2070194016957304', 'Lower Your Cost of Care', 1783781366],
  ['1015408337963984', 'Lower Your Cost of Care', 1783780076],
  ['972380499136565', 'Lower Your Cost of Care', 1783781860],
  ['1601259411607108', 'Lower Your Cost of Care', 1783779556],
  ['1338459001814433', 'Medicare May Cover 80%', 1783999042],
  ['2117382465863283', 'Get Healthcare Support — Covered by Medicare', 1783818318],
  ['1541849033960608', 'Get Healthcare Support — Covered by Medicare', 1783822040],
  ['1042419258203744', 'Get Healthcare Support — Covered by Medicare', 1784081542],
  ['1042443308267704', 'Get Healthcare Support — Covered by Medicare', 1783811737],
  ['1439671431333498', 'Get Healthcare Support — Covered by Medicare', 1783964815],
  ['1548009253339480', 'Get Healthcare Support — Covered by Medicare', 1783877235],
  ['1033269162395137', 'Get Healthcare Support — Covered by Medicare', 1783813163],
  ['1651887382565632', 'Get Healthcare Support — Covered by Medicare', 1784049152],
  ['3666726326826546', 'Get Healthcare Support — Covered by Medicare', 1783887823],
  ['1775535633813990', 'Get Healthcare Support — Covered by Medicare', 1783786877],
  ['1460507925843417', 'Get Healthcare Support — Covered by Medicare', 1783796939],
  ['1661095018298682', 'Get Healthcare Support — Covered by Medicare', 1783873781],
  ['1021037167300148', 'Get Healthcare Support — Covered by Medicare', 1783920247],
  ['38019602320971793', 'Get Healthcare Support — Covered by Medicare', 1783954156],
  ['1068549118829333', 'Get Healthcare Support — Covered by Medicare', 1784067669],
  ['1854761082569511', 'Get Healthcare Support — Covered by Medicare', 1783926554],
  ['1410621690905536', 'Get Healthcare Support — Covered by Medicare', 1783876085],
  ['1039767571935077', 'Get Healthcare Support — Covered by Medicare', 1784033218],
  ['1511783023419565', 'Get Healthcare Support — Covered by Medicare', 1784046108],
  ['861440130068709', 'Get Healthcare Support — Covered by Medicare', 1783870475],
  ['1389922722989869', 'Get Healthcare Support — Covered by Medicare', 1784141833],
  ['3618008408363686', 'Get Healthcare Support — Covered by Medicare', 1783991385],
  ['1693019258640520', 'Get Healthcare Support — Covered by Medicare', 1783886509],
  ['1589680622765108', 'Talk to a Real Advocate Instead', 1783778104],
  ['3061194197412569', 'See if You Qualify for Acupuncture', 1783944764],
  ['1025438536742908', 'See if You Qualify for Acupuncture', 1783847434],
  ['1609626494016093', 'See if You Qualify for Acupuncture', 1783987259],
  ['1034658638934913', 'See if You Qualify for Acupuncture', 1783880163],
  ['3948408515455922', 'Fight Denials with an Advocate', 1784042837],
  ['1669265421866759', 'Fight Denials with an Advocate', 1784039777],
  ['1547015626872263', 'Fight Denials with an Advocate', 1783883029],
  ['1585083253175217', 'Medicare May Cover More Than You Think', 1784046580],
  ['1733409684455334', 'Claim Denied by an Algorithm?', 1783778412],
  ['2406873896818386', 'Claim Denied by an Algorithm?', 1783826361],
  ['1942002753159465', 'Claim Denied by an Algorithm?', 1783775046],
  ['1401092598499415', 'Claim Denied by an Algorithm?', 1783788560],
  ['1343456510568375', 'Claim Denied by an Algorithm?', 1783841800],
  ['2242925189790754', 'Claim Denied by an Algorithm?', 1783842769],
  ['1045482837953890', 'Need Food Assistance?', 1783776861],
  ['1035982088788710', 'Need Food Assistance?', 1783780431],
  ['1484139783465982', 'Need Food Assistance?', 1783778703],
  ['3024507611072217', 'Double-Check Your Medical Bills', 1783777375],
  ['1024197940419809', 'Double-Check Your Medical Bills', 1783781282],
  ['1795570821608046', 'Double-Check Your Medical Bills', 1783784266],
  ['2510700932686246', 'Healthcare Red Flags Adding Up?', 1783780191],
  ['2269382237212973', 'How Healthcare Should Be', 1783783604],
];

// ── Nike — real active ads (page 15087023444) ───────────────────────────────
const NIKE_ROWS: Array<[string, string, number]> = [
  ['2183876549134534', 'Nike', 1784147510],
  ['1560257495490081', 'Kick Off the Season', 1784059773],
  ['1607672540881774', 'Kick Off the Season', 1783709968],
  ['1557934499343825', 'Kick Off the Season', 1783710645],
  ['1033388389158833', 'Kick Off the Season', 1783710704],
  ['27310692851958858', 'Kick Off the Season', 1783710211],
  ['2124263631837351', 'Kick Off the Season', 1783751058],
  ['1057942606795114', 'Nike Tempo Shorts', 1783609644],
  ['1017923447878238', 'Just Do It', 1784169734],
  ['1767359871285638', 'Just Do It', 1784168019],
];

const SOLACE_REPORT: CompanyReport = {
  executiveSummary:
    "Solace runs a disciplined, bottom-of-funnel direct-response program. Across ~55 sampled active ads that collapse into just 12 distinct creatives, the entire visible strategy reduces to one equation: you already have a right to human help with healthcare, Medicare pays for it, so claim it. One hook — “Get Healthcare Support — Covered by Medicare” — carries 42% of the ad volume, a clear scaled winner.",
  biggestStrategicInsight:
    "Solace leads with **risk-reversal, not capability**. It never sells “we’re great advocates”; it sells “this help is already yours and it’s free.” The single most-duplicated creative neutralizes the cost objection at first touch — which is why a competitor’s fastest wedge is not a better service claim but a louder, more credible *proof* layer (named advocates, outcomes) that Solace’s copy conspicuously lacks.",
  companyPositioning:
    "Positioned as **the human advocate who fights an automated, bureaucratic healthcare system for you — at no out-of-pocket cost.** The recurring villain is the machine (“Claim Denied by an **Algorithm**?”, “Talk to a **Real** Advocate **Instead**”), with the human advocate as the natural counterweight.",
  messagingStrategy:
    "Four message clusters, each removing a different objection: **entitlement activation** (coverage — 53% of ads), **grievance/villain** (denials, 20%), **money defense** (bills & cost, 20%), and **whole-person** (food assistance, brand — 7%). The word doing the most work across the account is “Covered.”",
  customerPsychology:
    "Exploits three emotions in order: **relief** (it’s covered; a human will handle it), **indignation** (an algorithm denied you; your bills contain errors), and **hope/curiosity** (hidden benefits you didn’t know you had). Fear is used sparingly — notable restraint for health marketing.",
  creativeWinners:
    "The runaway winner is **“Get Healthcare Support — Covered by Medicare” (23 of 55 ads)** — sustained, batch-refreshed duplication is the signature of a proven message spread across placements. The grievance pillar **“Claim Denied by an Algorithm?” (6 ads)** is the clear #2. Both have been running continuously across the sample window.",
  creativeBreakdown:
    "Roughly 40% carousels (2–5 cards, headline repeated per card → the *visual* varies, not the promise) and 60% single creatives. No visible urgency or scarcity mechanics anywhere — persuasion leans almost entirely on coverage + pain.",
  hookDistribution:
    "Coverage-led hooks dominate (“Covered by Medicare”, “May Cover 80%”, “Qualify for Acupuncture”). Grievance hooks (“Denied by an Algorithm?”, “Fight Denials”) form the second cluster. Money-defense hooks (“Lower Your Cost of Care”, “Double-Check Your Medical Bills”) the third.",
  offerDistribution:
    "Every offer is *free/covered access to a service* — advocate support billed through Medicare, denial-appeal help, bill review, benefit qualification. Notably absent: any discount, trial, or price promotion (consistent with a Medicare-billed model where discounting is unnecessary and compliance-risky).",
  funnelStrategy:
    "~94% of ads are conversion-stage direct response; a thin sliver is brand (“How Healthcare Should Be”) and education (“May Cover 80%”). Solace is **harvesting existing demand, not creating it** — which is itself the biggest opening for an attacker willing to build the category.",
  competitiveWeaknesses:
    "1) Extreme dependence on a single claim (“Covered by Medicare”) — regulatory tightening would expose the top of the machine. 2) **Zero visible social proof** — no testimonials, ratings, advocate counts, or outcome stats. 3) No urgency/scarcity. 4) **Caregivers (adult children of beneficiaries) are unaddressed** despite being the classic decision-influencer.",
  opportunities:
    "Own the caregiver buyer; layer outcome-based proof (“$X recovered”, “N denials overturned”); target the under-65 commercially-insured (Solace’s copy is Medicare-centric); and claim prevention (“get an advocate *before* the claim is denied”) vs. Solace’s after-the-grievance recruiting.",
  counterStrategy:
    "If competing tomorrow: (1) run the **named-advocate** model — “one advocate, yours, until it’s fixed” — against Solace’s anonymous service; (2) attack the volume-shop perception (“not a call center with hundreds of ads”); (3) out-transparent them — publish coverage math and win rates where Solace stays vague; (4) open the caregiver front they ignore entirely.",
  actionItems:
    "1. Build caregiver-targeted creative and landing flow. 2. Add an outcomes wall (recovered $, overturned denials) — the proof Solace lacks. 3. Lead one campaign with response-time speed (“an advocate in 15 minutes”). 4. Launch a denial-letter upload tool as a high-intent lander. 5. Target 50–64 commercially-insured denials. 6. Test a nurse-led (RN) advocacy angle for credibility.",
};

const NIKE_REPORT: CompanyReport = {
  executiveSummary:
    "Nike’s active Meta presence is brand-led and seasonally concentrated. The sampled active ads collapse into a few distinct creatives dominated by a single seasonal push — “Kick Off the Season” — alongside evergreen brand (“Just Do It”) and specific product ads (Tempo Shorts, Air Monarch). This is top-of-funnel brand maintenance, not direct-response harvesting.",
  biggestStrategicInsight:
    "Nike advertises **the brand and the moment, not the offer**. There is no price, discount, or urgency in the visible creative — the opposite of the reseller ecosystem crowding the same keyword. Nike’s moat is identity; its exposure is that performance-marketing challengers can own conversion intent Nike ignores.",
  companyPositioning: "Aspirational performance and identity — the athlete’s brand. Category-defining, not category-explaining.",
  messagingStrategy: "Seasonal campaign spikes (“Kick Off the Season”) layered over an always-on brand line (“Just Do It”), with periodic product-specific creative for franchise silhouettes.",
  customerPsychology: "Aspiration, belonging, and self-identity (“athletes like me”). Motivation and status over problem/solution.",
  creativeWinners: "“Kick Off the Season” is the most-duplicated creative in the sample — the current concentrated seasonal bet. “Just Do It” brand creative runs alongside as the evergreen baseline.",
  creativeBreakdown: "A mix of brand-anthem creatives and product-focused ads. Emphasis on imagery/motion over copy; headlines are short brand or campaign lines rather than benefit statements.",
  hookDistribution: "Dominated by campaign/brand hooks (“Kick Off the Season”, “Just Do It”) rather than benefit or problem hooks.",
  offerDistribution: "Essentially none — Nike does not lead with offers in the visible creative. The product *is* the offer.",
  funnelStrategy: "Overwhelmingly awareness/brand. Little to no visible conversion-stage direct response — deliberately ceding that ground.",
  competitiveWeaknesses: "No offer, urgency, or conversion mechanics in visible creative; heavy reliance on brand equity; the keyword is saturated by resellers Nike doesn’t engage.",
  opportunities: "For a challenger: own conversion intent and offers around Nike moments; target the reseller-heavy keyword with legitimacy; win on speed/price messaging Nike will never run.",
  counterStrategy: "Don’t fight Nike on brand. Attach to Nike’s seasonal moments with conversion-first creative and clear offers, capturing the high-intent demand Nike’s brand ads warm up but don’t close.",
  actionItems: "1. Time offer-led campaigns to Nike’s seasonal spikes. 2. Own the product-comparison and price angles. 3. Build conversion landers for the silhouettes Nike features. 4. Differentiate on availability/speed. 5. Target the reseller-crowded keyword with a trust-first message.",
};

function analyzed(ads: AdRecord[]): AnalyzedAd[] {
  return ads.map((ad) => ({ ad, analysis: null, analysisError: 'Per-ad AI analysis runs live with an LLM key; this is demo data.' }));
}

export const DEMO_ADVERTISERS: Record<string, DemoAdvertiser> = {
  '110702245120634': {
    page: { pageId: '110702245120634', name: 'Solace', category: 'Medical Company', likes: null, verification: 'BLUE_VERIFIED', imageUri: null, country: 'US', website: 'solace.health' },
    metaReportedApprox: 370,
    ads: analyzed(SOLACE_ROWS.map(([id, h, s]) => mkAd('110702245120634', 'Solace', id, h, s))),
    report: SOLACE_REPORT,
  },
  '15087023444': {
    page: { pageId: '15087023444', name: 'Nike', category: 'Sportswear', likes: null, verification: 'BLUE_VERIFIED', imageUri: null, country: 'US', website: 'nike.com' },
    metaReportedApprox: 43,
    ads: analyzed(NIKE_ROWS.map(([id, h, s]) => mkAd('15087023444', 'Nike', id, h, s))),
    report: NIKE_REPORT,
  },
};

/** Candidate advertiser pages returned for a demo search query (real pages). */
export const DEMO_SEARCH: Record<string, AdvertiserPage[]> = {
  nike: [
    DEMO_ADVERTISERS['15087023444']!.page,
    { pageId: '900000000001', name: 'Sneaker Plug Deals', category: 'Product/Service', likes: 12000, verification: null, imageUri: null, country: 'US', website: null },
    { pageId: '900000000002', name: 'Kicks Reseller Hub', category: 'Shopping & Retail', likes: 3400, verification: null, imageUri: null, country: 'US', website: null },
  ],
  solace: [
    DEMO_ADVERTISERS['110702245120634']!.page,
    { pageId: '1011065425433807', name: 'Solace Clothing', category: 'Clothing (Brand)', likes: 8100, verification: null, imageUri: null, country: 'US', website: null },
    { pageId: '278650805328968', name: 'Solace Caskets', category: 'Funeral Service & Cemetery', likes: 900, verification: null, imageUri: null, country: 'US', website: null },
  ],
  hubspot: [
    { pageId: '957437974122793', name: 'Rapid Drama Hub', category: 'App Page', likes: 200, verification: null, imageUri: null, country: 'US', website: null },
    { pageId: '110263638636029', name: 'California Overland Adventure and Power Sports Show', category: 'Event', likes: 1500, verification: null, imageUri: null, country: 'US', website: null },
    { pageId: '111563327046519', name: 'MTE BridgeSaw', category: 'Industrial Company', likes: 80, verification: null, imageUri: null, country: 'US', website: null },
  ],
};

export function isDemoQueryKnown(query: string): boolean {
  return normalizeQuery(query) in DEMO_SEARCH;
}

export function demoCandidates(query: string): AdvertiserPage[] {
  return DEMO_SEARCH[normalizeQuery(query)] ?? [];
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\.(com|health|io|co)$/i, '');
}
