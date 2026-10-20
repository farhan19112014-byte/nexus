/**
 * Tiny history-API router (no dependency): the site has five destinations, so a 40-line router
 * is clearer than a library. The server already falls back to index.html for unknown paths.
 */
import { useEffect, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';
import { stripBase, withBase } from './webDemo';

export type Route = 'home' | 'app' | 'about' | 'privacy' | 'sheet' | 'notfound';
export const PATHS = { home: '/', app: '/app', about: '/about', privacy: '/privacy' } as const;

export function routeFor(pathname: string, search = ''): Route {
  if (new URLSearchParams(search).has('sheet')) return 'sheet'; // character sheet (dev/reference)
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/') return 'home';
  if (p === '/app' || p === '/settings') return 'app';
  if (p === '/about') return 'about';
  if (p === '/privacy') return 'privacy';
  return 'notfound';
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());
if (typeof window !== 'undefined') window.addEventListener('popstate', notify);
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const snapshot = () => (typeof location === 'undefined' ? '/' : stripBase(location.pathname) + location.search + location.hash);

export function useLocation() { return useSyncExternalStore(subscribe, snapshot, () => '/'); }

/** Navigate inside the app. Hash-only targets on the same page scroll to the section (respecting reduced motion). */
export function navigate(to: string, o: { replace?: boolean } = {}) {
  const url = new URL(withBase(to), location.href);
  if (url.origin !== location.origin) { location.href = to; return; }
  const samePage = url.pathname === location.pathname && url.search === location.search;
  if (o.replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
  notify();
  if (url.hash) requestAnimationFrame(() => scrollToHash(url.hash));
  else if (!samePage) window.scrollTo({ top: 0 });
}

export function scrollToHash(hash: string) {
  const el = document.getElementById(decodeURIComponent(hash.slice(1)));
  if (!el) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches || document.querySelector('.rm') !== null;
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  // move keyboard focus to the section so the next Tab continues from there
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}

/** <a> that navigates without a page reload; modified clicks (new tab etc.) behave normally. */
export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault(); navigate(to);
  };
  return <a href={withBase(to)} onClick={handle} {...rest} />;
}

/** Sets document.title for a page. */
export function useTitle(title: string) { useEffect(() => { document.title = title; }, [title]); }
