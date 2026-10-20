/**
 * Hosted web demo (e.g. GitHub Pages): a static build with no NEXUS server behind it.
 * Built with VITE_WEB_DEMO=1. Everything that runs in the browser works (robot, animation, skills, memory, reminders,
 * the scripted demo brain); anything that needs the server (a real AI, API keys, speech services, Ollama) is clearly
 * marked unavailable — the demo brain is always labelled "not an LLM".
 */
export const WEB_DEMO = import.meta.env.VITE_WEB_DEMO === '1';
/** Base path the site is served from ('' at the domain root, '/nexus' on GitHub Pages). */
export const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/+$/, '');
/** Prefix an absolute in-app path with the base path. */
export const withBase = (p: string) => (p.startsWith('/') && !p.startsWith('//') ? `${BASE}${p}` : p);
/** Remove the base path from a pathname. */
export const stripBase = (p: string) => (BASE && (p === BASE || p.startsWith(`${BASE}/`)) ? p.slice(BASE.length) || '/' : p);
export const REPO_URL = 'https://github.com/farhan19112014-byte/nexus';
