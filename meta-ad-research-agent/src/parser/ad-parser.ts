import type { AdRecord, AdvertiserPage, CreativeAsset, CreativeType } from '../types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('parser');

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Read the first present key from a list of aliases (camelCase vs snake_case). */
function pick(obj: Obj, keys: string[]): unknown {
  for (const key of keys) {
    if (key in obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return null;
}

function asString(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v;
  if (typeof v === 'number') return String(v);
  return null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x !== '');
}

/** Unix seconds (or ms) -> "YYYY-MM-DD". */
function toIsoDate(v: unknown): string | null {
  const n = asNumber(v);
  if (n === null) {
    const s = asString(v);
    // Already ISO-ish?
    if (s && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return null;
  }
  const ms = n > 10_000_000_000 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Recursively walk a payload and collect every object that looks like an
 * Ad Library ad node: it has an ad archive id and a snapshot.
 */
export function findAdNodes(payload: unknown, found: Obj[] = [], depth = 0): Obj[] {
  if (depth > 25) return found;
  if (Array.isArray(payload)) {
    for (const item of payload) findAdNodes(item, found, depth + 1);
    return found;
  }
  if (!isObj(payload)) return found;

  const hasArchiveId = pick(payload, ['adArchiveID', 'ad_archive_id', 'adArchiveId']) !== null;
  const hasSnapshot = isObj(payload['snapshot']);
  if (hasArchiveId && hasSnapshot) {
    found.push(payload);
    // Collated results can nest further ad nodes; keep walking siblings only.
  }
  for (const value of Object.values(payload)) {
    findAdNodes(value, found, depth + 1);
  }
  return found;
}

function extractBodyText(snapshot: Obj): string | null {
  const body = snapshot['body'];
  if (isObj(body)) {
    const direct = asString(pick(body, ['text']));
    if (direct) return stripHtml(direct);
    const markup = body['markup'];
    if (isObj(markup)) {
      const html = asString(pick(markup, ['__html']));
      if (html) return stripHtml(html);
    }
  }
  return asString(body) ? stripHtml(asString(body) as string) : null;
}

function stripHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#039;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

function extractAssets(snapshot: Obj): CreativeAsset[] {
  const assets: CreativeAsset[] = [];

  const pushImage = (o: Obj) => {
    const url = asString(pick(o, ['original_image_url', 'originalImageURL', 'resized_image_url', 'resizedImageURL']));
    if (url) assets.push({ type: 'image', url, previewUrl: null, localPath: null });
  };
  const pushVideo = (o: Obj) => {
    const url = asString(pick(o, ['video_hd_url', 'videoHDURL', 'video_sd_url', 'videoSDURL']));
    const preview = asString(pick(o, ['video_preview_image_url', 'videoPreviewImageURL']));
    if (url || preview) assets.push({ type: 'video', url, previewUrl: preview, localPath: null });
  };

  for (const key of ['images', 'videos', 'cards']) {
    const list = snapshot[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!isObj(item)) continue;
      if (key === 'videos') pushVideo(item);
      else if (key === 'images') pushImage(item);
      else {
        // Carousel cards can hold either media type.
        pushImage(item);
        pushVideo(item);
      }
    }
  }
  return assets;
}

function inferCreativeType(displayFormat: string | null, assets: CreativeAsset[], snapshot: Obj): CreativeType {
  const fmt = displayFormat?.toUpperCase() ?? '';
  if (fmt.includes('CAROUSEL') || fmt === 'DCO' || (Array.isArray(snapshot['cards']) && (snapshot['cards'] as unknown[]).length > 1)) {
    return 'carousel';
  }
  if (fmt.includes('VIDEO') || assets.some((a) => a.type === 'video')) return 'video';
  if (fmt.includes('IMAGE') || assets.some((a) => a.type === 'image')) return 'image';
  if (fmt) return 'unknown';
  return assets.length === 0 ? 'text' : 'unknown';
}

/** Normalize one raw ad node into an AdRecord. Returns null if unusable. */
export function parseAdNode(node: Obj, searchCountry: string): AdRecord | null {
  const adArchiveId = asString(pick(node, ['adArchiveID', 'ad_archive_id', 'adArchiveId']));
  const snapshot = node['snapshot'];
  if (!adArchiveId || !isObj(snapshot)) return null;

  const cards = Array.isArray(snapshot['cards']) ? (snapshot['cards'] as unknown[]).filter(isObj) : [];
  const firstCard = cards[0] ?? null;

  const advertiserName =
    asString(pick(snapshot, ['page_name', 'pageName'])) ?? asString(pick(node, ['pageName', 'page_name'])) ?? 'Not Available';
  const pageId =
    asString(pick(node, ['pageID', 'page_id', 'pageId'])) ?? asString(pick(snapshot, ['page_id', 'pageID'])) ?? '';

  const isActive = pick(node, ['isActive', 'is_active']);
  const status: AdRecord['status'] = typeof isActive === 'boolean' ? (isActive ? 'active' : 'inactive') : 'unknown';

  const displayFormat = asString(pick(snapshot, ['display_format', 'displayFormat']));
  const assets = extractAssets(snapshot);

  const headline =
    asString(pick(snapshot, ['title'])) ?? (firstCard ? asString(pick(firstCard, ['title'])) : null);
  const description =
    asString(pick(snapshot, ['link_description', 'linkDescription'])) ??
    (firstCard ? asString(pick(firstCard, ['link_description'])) : null);
  const ctaText =
    asString(pick(snapshot, ['cta_text', 'ctaText'])) ?? (firstCard ? asString(pick(firstCard, ['cta_text'])) : null);
  const ctaType =
    asString(pick(snapshot, ['cta_type', 'ctaType'])) ?? (firstCard ? asString(pick(firstCard, ['cta_type'])) : null);
  const landingPageUrl =
    asString(pick(snapshot, ['link_url', 'linkURL'])) ?? (firstCard ? asString(pick(firstCard, ['link_url'])) : null);

  let adText = extractBodyText(snapshot);
  if (!adText && firstCard) adText = asString(pick(firstCard, ['body'])) ?? null;

  const platforms = asStringArray(pick(node, ['publisherPlatform', 'publisher_platform'])).map((p) => p.toLowerCase());

  return {
    adArchiveId,
    advertiserName,
    pageId,
    status,
    platforms,
    adText,
    headline,
    description,
    ctaText,
    ctaType,
    landingPageUrl,
    displayFormat,
    creativeType: inferCreativeType(displayFormat, assets, snapshot),
    assets,
    startDate: toIsoDate(pick(node, ['startDate', 'start_date'])),
    endDate: toIsoDate(pick(node, ['endDate', 'end_date'])),
    searchCountry,
    languages: asStringArray(pick(node, ['languages'])).concat(
      asStringArray(pick(snapshot, ['ad_creative_locales'])),
    ),
    collationCount: asNumber(pick(node, ['collationCount', 'collation_count'])),
    adLibraryUrl: `https://www.facebook.com/ads/library/?id=${adArchiveId}`,
    screenshotPath: null,
  };
}

/** Extract and dedupe all ads found across captured payloads. */
export function extractAds(payloads: unknown[], searchCountry: string): AdRecord[] {
  const byId = new Map<string, AdRecord>();
  for (const payload of payloads) {
    for (const node of findAdNodes(payload)) {
      const ad = parseAdNode(node, searchCountry);
      if (!ad) continue;
      const existing = byId.get(ad.adArchiveId);
      // Prefer the record with more populated fields when duplicates arrive.
      if (!existing || populatedFieldCount(ad) > populatedFieldCount(existing)) {
        byId.set(ad.adArchiveId, ad);
      }
    }
  }
  return [...byId.values()];
}

function populatedFieldCount(ad: AdRecord): number {
  return Object.values(ad).filter((v) => v !== null && (!Array.isArray(v) || v.length > 0)).length;
}

/**
 * Walk typeahead/search payloads for advertiser page suggestions.
 * Matches both the legacy `pageResults` shape and GraphQL page nodes.
 */
export function extractAdvertisers(payloads: unknown[]): AdvertiserPage[] {
  const byId = new Map<string, AdvertiserPage>();

  const visit = (value: unknown, depth = 0): void => {
    if (depth > 25) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (!isObj(value)) return;

    // Ad nodes also carry page metadata; they are not advertiser suggestions.
    const looksLikeAdNode = pick(value, ['adArchiveID', 'ad_archive_id']) !== null || isObj(value['snapshot']);

    const id = looksLikeAdNode ? null : asString(pick(value, ['page_id', 'pageID', 'id']));
    const name = asString(pick(value, ['name', 'page_name']));
    const hasPageSignal =
      pick(value, ['category', 'page_alias', 'likes', 'verification', 'image_uri', 'imageURI', 'page_profile_uri']) !== null;
    if (id && /^\d{5,}$/.test(id) && name && hasPageSignal) {
      if (!byId.has(id)) {
        byId.set(id, {
          pageId: id,
          name,
          category: asString(pick(value, ['category'])),
          likes: asNumber(pick(value, ['likes', 'like_count'])),
          verification: asString(pick(value, ['verification', 'page_verification'])),
          imageUri: asString(pick(value, ['image_uri', 'imageURI'])),
          country: asString(pick(value, ['country'])),
        });
      }
    }
    for (const v of Object.values(value)) visit(v, depth + 1);
  };

  for (const payload of payloads) visit(payload);
  const advertisers = [...byId.values()];
  log.debug(`Extracted ${advertisers.length} advertiser candidates`);
  return advertisers;
}
