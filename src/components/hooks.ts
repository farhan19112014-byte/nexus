import { useEffect, useState, useSyncExternalStore } from 'react';
import { companion } from '../core/runtime';
export const useSnapshot = () => useSyncExternalStore(companion.subscribe, companion.getSnapshot);
export function useStore(s: { subscribe(f: () => void): () => void; version: number }) { return useSyncExternalStore((f) => s.subscribe(f), () => s.version); }
export function usePoll<T>(fn: () => T, ms = 200): T { const [v, setV] = useState(fn); useEffect(() => { const i = setInterval(() => setV(fn()), ms); return () => clearInterval(i); }, [fn, ms]); return v; }
export function download(name: string, text: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export const fmtTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const fmtDate = (t: number) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
