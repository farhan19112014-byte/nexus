/** The theme actually shown ('dark' | 'light'), following <html data-theme> so every component updates together. */
import { useSyncExternalStore } from 'react';

const read = (): 'dark' | 'light' => (typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
function subscribe(cb: () => void) {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => {};
  const mo = new MutationObserver(cb); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
}
export function useResolvedTheme(): 'dark' | 'light' { return useSyncExternalStore(subscribe, read, () => 'dark'); }
