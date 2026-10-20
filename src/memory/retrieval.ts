/** Asset 54 — relevance-ranked memory retrieval (BM25-lite). Only relevant items enter a request. */
const STOP = new Set('a an the and or but if of to in on at for with is are was were be been am i me my you your it this that these those do does did have has had what which who how why when where can could would should will just about from as by not no yes so too very please tell know'.split(' '));
export const tokens = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)).map((w) => w.replace(/(ing|es|s)$/, ''));

export interface Retrievable { id: string; text: string; category: string; updatedAt: number }

export function rankMemories<T extends Retrievable>(items: T[], query: string, k = 5): { item: T; score: number }[] {
  const q = new Set(tokens(query));
  if (!q.size) return [];
  const docs = items.map((it) => ({ it, toks: tokens(it.text) }));
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d.toks)) df.set(w, (df.get(w) ?? 0) + 1);
  const N = docs.length || 1;
  return docs.map(({ it, toks }) => {
    let s = 0;
    for (const w of new Set(toks)) if (q.has(w)) s += Math.log(1 + N / (df.get(w) ?? 1));
    return { item: it, score: s / Math.sqrt(1 + toks.length / 8) };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt).slice(0, k);
}

export function jaccard(a: string, b: string) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let i = 0; for (const x of A) if (B.has(x)) i++;
  return i / (A.size + B.size - i);
}
