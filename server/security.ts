/**
 * HTTP security headers for everything the NEXUS server sends (the app's pages and the API).
 *
 * Content-Security-Policy, built from what the app actually loads:
 *   scripts   only this site's own files, plus the inline theme/boot script(s) of index.html by SHA-256 hash
 *             (no 'unsafe-inline', no 'unsafe-eval' — model output is never run as code)
 *   styles    this site + inline styles (React style attributes and index.html's boot styles need 'unsafe-inline';
 *             styles cannot run code)
 *   images    this site, data: and blob: (three.js textures)     fonts  this site, data:
 *   audio     this site and blob: (spoken replies are played from blob: URLs); on your own computer also https:
 *             (ElevenLabs voice previews in Settings, which come from ElevenLabs' storage)
 *   connect   this site (the API, the 3D model) + any extra API origin (a static site calling a hosted server)
 *   workers   this site and blob:          frames  none          embedding by other sites  none
 * The GitHub Pages build gets the same policy as a <meta> tag (see vite.config.ts), minus frame-ancestors, which a
 * <meta> policy cannot express (GitHub Pages cannot send headers).
 */
import { createHash } from 'node:crypto';

export interface CspOptions { inlineScripts?: string[]; connect?: string[]; publicMode: boolean; meta?: boolean }

/** SHA-256 hashes of the inline <script> blocks (without src) in an HTML page, for script-src. */
export function inlineScriptHashes(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) if (m[1].trim()) out.push(`'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  return out;
}

export function buildCsp(o: CspOptions): string {
  // the Wikipedia API is the visual presenter's free image search when there is no NEXUS server (offline web demo)
  const connect = ["'self'", ...(o.connect ?? []).filter((u) => /^https?:\/\/[^/\s;,']+$/i.test(u)), 'https://en.wikipedia.org'];
  const d: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", ...(o.inlineScripts ?? [])]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    // reference images shown by the visual presenter come only from Wikimedia Commons' image host
    ['img-src', ["'self'", 'data:', 'blob:', 'https://upload.wikimedia.org', 'https://thumb.wikimedia.org']],
    ['font-src', ["'self'", 'data:']],
    ['media-src', ["'self'", 'blob:', 'data:', ...(o.publicMode ? [] : ['https:'])]],
    ['connect-src', connect],
    ['worker-src', ["'self'", 'blob:']],
    ['manifest-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['frame-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ...(o.meta ? [] : [['frame-ancestors', ["'none'"]] as [string, string[]]]),
  ];
  return d.map(([k, v]) => `${k} ${v.join(' ')}`).join('; ');
}

/** The other headers, safe for both pages and API responses. */
export function baseSecurityHeaders(publicMode: boolean): Record<string, string> {
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    // microphone only for this site (voice input); nothing else
    'permissions-policy': 'microphone=(self), camera=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    'cross-origin-opener-policy': 'same-origin',
    ...(publicMode ? { 'strict-transport-security': 'max-age=31536000' } : {}),
  };
}
