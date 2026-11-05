/**
 * Find a real, freely licensed reference image for a topic: Wikipedia's search picks the article, the article's lead
 * image (free licences only — `pilicense=free`) is the picture, and Wikimedia Commons' metadata gives its author,
 * licence and file page so the app can credit it. No key, no cost. Used by the NEXUS server (/api/visual/image) and,
 * when there is no server (the offline web demo), directly by the browser (the MediaWiki API allows CORS with origin=*).
 * Every failure returns null — the caller shows the explanation without a picture.
 */
import { isAllowedImageUrl, plainText, type ImageResult } from './visual';

export interface ImageSearchOptions { base?: string; lang?: string; signal?: AbortSignal; fetch?: typeof fetch; width?: number; headers?: Record<string, string> }
type Page = { pageid: number; title: string; index?: number; fullurl?: string; pageimage?: string; thumbnail?: { source: string; width: number; height: number } };
type Meta = Record<string, { value?: string } | undefined>;

export async function findImage(query: string, o: ImageSearchOptions = {}): Promise<ImageResult | null> {
  const q = query.trim().slice(0, 80); if (q.length < 2) return null;
  const f = o.fetch ?? fetch; const lang = o.lang ?? 'en'; const w = o.width ?? 960;
  const api = `${o.base ?? `https://${lang}.wikipedia.org`}/w/api.php`;
  const get = async (params: string): Promise<unknown> => {
    const r = await f(`${api}?${params}&format=json&formatversion=2&origin=*`, { signal: o.signal, headers: o.headers });
    if (!r.ok) throw new Error(`image search returned HTTP ${r.status}`);
    return r.json();
  };
  const s = await get(`action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=5&gsrnamespace=0&prop=pageimages|info&piprop=thumbnail|name&pithumbsize=${w}&pilicense=free&inprop=url`) as { query?: { pages?: Page[] } };
  const pages = (s.query?.pages ?? []).slice().sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
  const hit = pages.find((p) => p.pageimage && p.thumbnail && isAllowedImageUrl(p.thumbnail.source));
  if (!hit || !hit.pageimage || !hit.thumbnail) return null;
  // the file's licence and author (Commons metadata, served through the wiki for shared files)
  let meta: Meta = {}; let fileUrl = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(hit.pageimage)}`;
  try {
    const m = await get(`action=query&titles=${encodeURIComponent(`File:${hit.pageimage}`)}&prop=imageinfo&iiprop=extmetadata|url`) as { query?: { pages?: { imageinfo?: { extmetadata?: Meta; descriptionurl?: string }[] }[] } };
    const ii = m.query?.pages?.[0]?.imageinfo?.[0];
    meta = ii?.extmetadata ?? {};
    if (ii?.descriptionurl && /^https:\/\/(commons\.wikimedia\.org|[a-z-]+\.wikipedia\.org)\//.test(ii.descriptionurl)) fileUrl = ii.descriptionurl;
  } catch { /* licence lookup failed: still credit the file page, licence "see source" */ }
  const license = plainText(meta.LicenseShortName?.value, 40) || 'See source';
  const licenseUrl = meta.LicenseUrl?.value && /^https?:\/\//.test(meta.LicenseUrl.value) ? meta.LicenseUrl.value : null;
  return {
    url: hit.thumbnail.source, width: hit.thumbnail.width, height: hit.thumbnail.height,
    title: hit.title.slice(0, 120), pageUrl: hit.fullurl && /^https:\/\//.test(hit.fullurl) ? hit.fullurl : `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(hit.title)}`,
    fileUrl, author: plainText(meta.Artist?.value, 100) || 'Unknown', license, licenseUrl, source: 'Wikimedia Commons',
  };
}
