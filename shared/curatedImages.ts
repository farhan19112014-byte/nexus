/**
 * Photos Farhan supplied himself for people Wikimedia Commons has no free picture of. Matched on the person's name, or on
 * the question that is about them; served from the site itself (/images/…), so no lookup and no other person's photo.
 */
import type { ImageResult } from './visual';

interface Curated { name: string; match: RegExp; about?: RegExp[]; caption: string; path: string; width: number; height: number; pageUrl: string }
const CURATED: Curated[] = [
  { name: 'Mithlesh Tiwari', match: /\bmith(?:i)?lesh\s+tiwar[iy]\b/i, about: [/\b(education\s+minister|minister\s+(?:of|for)\s+education|shiksha\s+mantri)\b/i, /\bbihar\b/i],
    caption: 'The Honourable Education Minister of Bihar, Mithlesh Tiwari', path: '/images/people-mithlesh-tiwari.png', width: 587, height: 505, pageUrl: 'https://en.wikipedia.org/wiki/Mithlesh_Tiwari' },
];
/** the curated entry for a text that names the person, or asks the question about them (every pattern in `about`) */
export function curatedFor(...texts: (string | null | undefined)[]): { query: string; caption: string } | null {
  const t = texts.filter(Boolean).join('\n');
  const c = CURATED.find((x) => x.match.test(t) || (x.about?.length && x.about.every((re) => re.test(t))));
  return c ? { query: c.name, caption: c.caption } : null;
}
export function curatedImage(query: string, origin: string): ImageResult | null {
  const c = CURATED.find((x) => x.match.test(query)); if (!c || !origin) return null;
  return { url: `${origin.replace(/\/+$/, '')}${c.path}`, width: c.width, height: c.height, title: c.name, pageUrl: c.pageUrl, fileUrl: c.pageUrl, author: 'Provided by Farhan', license: 'Used with permission', licenseUrl: null, source: 'NEXUS' };
}
