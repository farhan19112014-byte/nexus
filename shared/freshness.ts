/**
 * Time-sensitive facts (who holds an office now, dates, prices, latest versions…): NEXUS must not answer these from the
 * model's training data, which has a cutoff and goes stale. Shared by the server (which decides to research, ranks the
 * sources and records whether the answer was verified) and the browser (which shows the verification line).
 */

import { officeLookup } from './offices';

/** Positions whose holder changes: government, courts, organisations, teams. */
const ROLE = String.raw`(president|vice[- ]president|prime minister|pm|deputy prime minister|chief minister|cm|deputy chief minister|governor|lieutenant governor|lt\.? governor|minister|cabinet secretary|secretary of state|foreign secretary|home secretary|chancellor|premier|mayor|speaker|chief justice|justice|judge|attorney general|solicitor general|chief election commissioner|election commissioner|ambassador|high commissioner|envoy|chief of (army|naval|air) staff|army chief|chief of defence staff|ceo|chief executive|chairman|chairperson|chair|director[- ]general|secretary[- ]general|managing director|head|leader|king|queen|monarch|pope|captain|coach|manager|mp|mla|senator|member of parliament|commissioner|registrar|vice[- ]chancellor|principal|dean|editor|founder|owner|champion|title holder|record holder)`;
/** Asking about who holds a position — always time-sensitive. */
const ROLE_PATTERNS: RegExp[] = [
  // "who is the governor of Bihar", "who's the current CM of Delhi", "who are the ministers of…"
  new RegExp(String.raw`\bwho(?:'s| is| are| was| were)?\b[^?.!]{0,40}\b${ROLE}\b`, 'i'),
  new RegExp(String.raw`\b(current|present|incumbent|sitting|newly appointed|acting|serving)\s+(?:\w+\s+){0,3}${ROLE}\b`, 'i'),
  new RegExp(String.raw`^\s*(the\s+)?${ROLE}\s+of\s+(the\s+)?[\w.'-]+\s*\??\s*$`, 'i'),   // just "President of India?"
];
/** "… the Governor of Bihar …" inside a question */
const ROLE_OF = new RegExp(String.raw`\b${ROLE}\s+of\s+(the\s+)?[A-Z][\w.'-]+`, '');
/** Words that make a factual QUESTION time-sensitive (dates, prices, "latest"…) — counted only in a question. */
const GENERIC: RegExp[] = [
  /\b(right now|currently|at present|as of (today|now)|these days|nowadays|today'?s|this (week|month|year)|latest|most recent|newest|up[- ]to[- ]date|still)\b/i,
  /\b(price|cost of|exchange rate|stock|share price|market cap|inflation|repo rate|interest rate|gdp|population|ranking|standings|weather|forecast|release date|latest version|election result|deadline|schedule|holiday)\b/i,
  /\b(news|headlines?|recent(ly)?|just (released|launched|announced)|released|launched|announced|new (model|version|update|release|iphone|pixel|galaxy)|who won|winner of|score|how much (is|does|are)|how many (people|users|countries|states|members))\b/i,
  /\b(20[2-9]\d)\b/, /\bwhen (is|will|does)\b/i, /\b(is|are) (he|she|they|it) still\b/i,
];
const QUESTION = /\?|^\s*(who|what|when|which|where|how|is|are|was|does|did|do|tell me|give me|list|name|check)\b/i;
const CHAT = /^\s*(hi|hello|hey|thanks|thank you|how are you|how's it going|what's up|good (morning|afternoon|evening|night))\b/i;
/** Maths and programming: answered without a search, whatever words they contain. */
const MATH = /^[\s\d().,+\-*/^%=x×÷?]*$|\b(calculate|solve|simplify|factor(ise|ize)?|differentiate|integrate|derivative|integral|square root|equation|convert \d|\d+\s*[-+*/^×÷]\s*\d+|percent(age)? of)\b/i;
const CODE = /```|=>|[{};]\s*$|\b(write|fix|debug|refactor|implement)\b[^?]{0,60}\b(code|function|script|program|query|regex|class|loop)\b|\b(code|coding|bug|debug|exception|stack trace|compile|syntax error|regex|algorithm)\b/i;
/** Asking for an explanation, a story or a definition — timeless unless it names a current position. */
const TIMELESS = /^\s*(explain|define|describe how|how does|how do|why (is|are|do|does)|what (is|are) (a|an)\b|tell me (a|an) (story|joke|poem)|write|translate|summari[sz]e)\b/i;
/** True for questions whose answer can change over time (current officeholders, dates, prices, latest…). */
export function isTimeSensitive(text: string): boolean {
  const t = text.slice(0, 1000);
  if (MATH.test(t) || CODE.test(t)) return false;
  if (officeLookup(t)) return true;   // who holds a public office now (also lists: "chief ministers of all states")
  if (ROLE_PATTERNS.some((p) => p.test(t))) return true;
  if (!QUESTION.test(t) || CHAT.test(t)) return false;
  if (ROLE_OF.test(t)) return true;
  return !TIMELESS.test(t) && GENERIC.some((p) => p.test(t));
}

/** Follow-ups ("and who is it now?") have no subject of their own: the previous question is added to the search. */
export function freshQueryWith(text: string, previous?: string): string {
  const q = freshQuery(text);
  const vague = q.split(' ').filter((w) => w.length > 2 && !/^(one|now|him|her|they|them|that|this|there|and|still|she|his|its)$/i.test(w)).length < 2;
  return vague && previous ? `${freshQuery(previous)} ${q}`.trim().slice(0, 160) : q;
}

/** A search query for a time-sensitive question: question words and filler out, the subject kept ("governor of Bihar"). */
export function freshQuery(text: string): string {
  return text.replace(/[?!.]+/g, ' ')
    .replace(/\b(please|can you|could you|tell me|i want to know|do you know|search( for)?|look up|find out|who(?:'s| is| are| was)?|what(?:'s| is| are)?|which|is|are|the|current(ly)?|present|incumbent|right now|now|today|at present|as of|these days)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 160);
}

export type Authority = 'official' | 'reference' | 'other';
/** Official / primary sources first: government, parliament, courts, intergovernmental bodies. */
const OFFICIAL = /(^|\.)((gov|nic|gouv|gob|go|govt|government)\.[a-z]{2,3}|gov|mil|gc\.ca|parliament\.uk|sansad\.in|europa\.eu|un\.org|who\.int|worldbank\.org|imf\.org|rbi\.org\.in|sci\.gov\.in|eci\.gov\.in|india\.gov\.in|pib\.gov\.in)$/i;
const REFERENCE = /(^|\.)(wikipedia\.org|britannica\.com|wikidata\.org)$/i;
const REDIRECT = /(^|\.)vertexaisearch\.cloud\.google\.com$/i;
export function authorityOf(url: string, title = ''): Authority {
  let host = ''; try { host = new URL(url).hostname; } catch { return 'other'; }
  // Google Search grounding links are redirects; the result's title is the real site's domain
  if (REDIRECT.test(host)) { const t = title.trim().toLowerCase(); host = /^[a-z0-9.-]+\.[a-z]{2,}$/.test(t) ? t : ''; }
  return OFFICIAL.test(host) ? 'official' : REFERENCE.test(host) ? 'reference' : 'other';
}
const RANK: Record<Authority, number> = { official: 0, reference: 1, other: 2 };
/** Sort sources: official first, then reference works, then the rest; the search's own relevance order is kept within a group. Ids renumbered 1…n. */
export function rankSources<T extends { url: string; title?: string; publishedAt?: string | null; id: number }>(src: T[]): (T & { authority: Authority })[] {
  return src.map((s, i) => ({ ...s, authority: authorityOf(s.url, s.title), i }))
    .sort((a, b) => RANK[a.authority] - RANK[b.authority] || a.i - b.i)
    .map(({ i: _i, ...s }) => s as T & { authority: Authority })
    .map((s, i) => ({ ...s, id: i + 1 }));
}

/** What the server records about a time-sensitive answer (shown under the reply; never written by the model). */
export interface Freshness {
  timeSensitive: true;
  /** live sources were retrieved for this answer */
  verified: boolean;
  /** when the sources were retrieved (ISO) */
  checkedAt: string | null;
  /** the best source used (official first) */
  source: { title: string; url: string; authority: Authority; updatedAt: string | null } | null;
  /** why it could not be verified, or a caution about the sources (e.g. all of them are old) */
  note?: string;
  /** how many live sources were used */
  count?: number;
  /** the search service(s) that answered */
  via?: string;
}

export const fmtDay = (iso: string | null | undefined) => {
  if (!iso) return ''; const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};
