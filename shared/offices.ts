/**
 * Directory of public offices. What is stored here is only what rarely changes: India's states and union territories,
 * their capitals, and which office heads each one. WHO holds an office is never stored — it is looked up live from the
 * office's own Wikipedia page (its "incumbent" field) every time, with the page's last-edit date, so it cannot go stale.
 */
export interface Region { name: string; capital: string; kind: 'state' | 'ut'; /** has a chief minister */ cm: boolean; /** title of the centre's representative */ head: 'Governor' | 'Lieutenant Governor' | 'Administrator'; aliases?: string[]; /** the name used in Wikipedia's office page titles, when it differs */ wiki?: string; /** abbreviations, matched in capitals only ("UP", not "up") */ abbr?: string[] }
const S = (name: string, capital: string, aliases?: string[]): Region => ({ name, capital, kind: 'state', cm: true, head: 'Governor', aliases });
const U = (name: string, capital: string, cm: boolean, head: Region['head'], aliases?: string[]): Region => ({ name, capital, kind: 'ut', cm, head, aliases });
export const INDIA: Region[] = [
  { ...S('Andhra Pradesh', 'Amaravati'), abbr: ['AP'] }, S('Arunachal Pradesh', 'Itanagar'), S('Assam', 'Dispur'), S('Bihar', 'Patna'), S('Chhattisgarh', 'Raipur', ['Chattisgarh']),
  S('Goa', 'Panaji'), S('Gujarat', 'Gandhinagar'), S('Haryana', 'Chandigarh'), { ...S('Himachal Pradesh', 'Shimla'), abbr: ['HP'] }, S('Jharkhand', 'Ranchi'), S('Karnataka', 'Bengaluru'),
  S('Kerala', 'Thiruvananthapuram'), { ...S('Madhya Pradesh', 'Bhopal'), abbr: ['MP'] }, S('Maharashtra', 'Mumbai'), S('Manipur', 'Imphal'), S('Meghalaya', 'Shillong'), S('Mizoram', 'Aizawl'),
  S('Nagaland', 'Kohima'), S('Odisha', 'Bhubaneswar', ['Orissa']), { ...S('Punjab', 'Chandigarh'), wiki: 'Punjab, India' }, S('Rajasthan', 'Jaipur'), S('Sikkim', 'Gangtok'), { ...S('Tamil Nadu', 'Chennai', ['Tamilnadu']), abbr: ['TN'] },
  S('Telangana', 'Hyderabad'), S('Tripura', 'Agartala'), { ...S('Uttar Pradesh', 'Lucknow'), abbr: ['UP'] }, S('Uttarakhand', 'Dehradun', ['Uttaranchal']), { ...S('West Bengal', 'Kolkata', ['Bengal']), abbr: ['WB'] },
  { ...U('Andaman and Nicobar Islands', 'Sri Vijaya Puram', false, 'Lieutenant Governor', ['Andaman and Nicobar', 'Andaman & Nicobar', 'Andaman']), wiki: 'the Andaman and Nicobar Islands' },
  U('Chandigarh', 'Chandigarh', false, 'Administrator'),
  U('Dadra and Nagar Haveli and Daman and Diu', 'Daman', false, 'Administrator', ['Dadra and Nagar Haveli', 'Daman and Diu', 'Daman & Diu']),
  U('Delhi', 'New Delhi', true, 'Lieutenant Governor', ['NCT of Delhi', 'New Delhi']),
  U('Jammu and Kashmir', 'Srinagar (summer), Jammu (winter)', true, 'Lieutenant Governor', ['Jammu & Kashmir', 'J&K', 'Kashmir']),
  U('Ladakh', 'Leh', false, 'Lieutenant Governor'), U('Lakshadweep', 'Kavaratti', false, 'Administrator'),
  U('Puducherry', 'Puducherry', true, 'Lieutenant Governor', ['Pondicherry']),
];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** names and aliases, longest first, so "Dadra and Nagar Haveli and Daman and Diu" wins over "Daman and Diu" */
const REGION_NAMES = INDIA.flatMap((r) => [r.name, ...(r.aliases ?? [])].map((n) => ({ n, r }))).sort((a, b) => b.n.length - a.n.length);
export function findRegion(text: string): Region | null {
  // "Chandigarh" is also Punjab's and Haryana's capital: the state named in the question wins
  for (const { n, r } of REGION_NAMES) if (new RegExp(`(^|[^a-z])${esc(n)}($|[^a-z])`, 'i').test(text)) return r;
  for (const r of INDIA) for (const a of r.abbr ?? []) if (new RegExp(`(^|[^A-Za-z])${a}($|[^A-Za-z])`).test(text)) return r;
  return null;
}

type Kind = 'cm' | 'rep' | 'national';
const OFFICES: { re: RegExp; title: string; kind: Kind }[] = [
  { re: /\b(chief ministers?|cms?)\b/i, title: 'Chief Minister', kind: 'cm' },
  { re: /\b(lieutenant governors?|lt\.? ?governors?|lg)\b/i, title: 'Lieutenant Governor', kind: 'rep' },
  { re: /\bgovernors?\b/i, title: 'Governor', kind: 'rep' },
  { re: /\badministrators?\b/i, title: 'Administrator', kind: 'rep' },
  { re: /\b(prime ministers?|pms?)\b/i, title: 'Prime Minister', kind: 'national' },
  { re: /\bvice[- ]presidents?\b/i, title: 'Vice President', kind: 'national' },
  { re: /\bpresidents?\b/i, title: 'President', kind: 'national' },
  { re: /\bchief justices?\b/i, title: 'Chief Justice', kind: 'national' },
  { re: /\bchancellors?\b/i, title: 'Chancellor', kind: 'national' },
  { re: /\bkings?\b/i, title: 'King', kind: 'national' }, { re: /\bqueens?\b/i, title: 'Queen', kind: 'national' },
  { re: /\bemperors?\b/i, title: 'Emperor', kind: 'national' }, { re: /\bsultans?\b/i, title: 'Sultan', kind: 'national' },
  { re: /\bpremiers?\b/i, title: 'Premier', kind: 'national' }, { re: /\bsupreme leaders?\b/i, title: 'Supreme Leader', kind: 'national' },
];
/** questions about the past or about deputies are not "who holds it now": left to the ordinary search */
const NOT_CURRENT = /\b(was|were|former|previous|first|last|earlier|before|after|longest|youngest|oldest|history|deput(y|ies)|ex-|in (1[89]|20)\d\d|during|until|how many)\b/i;
const ALL = /\b(all|every|each|list|states?|union territor(y|ies)|uts?)\b/i;
const COUNTRY_ALIAS: Record<string, string> = { usa: 'the United States', us: 'the United States', america: 'the United States', 'united states': 'the United States', 'united states of america': 'the United States', uk: 'the United Kingdom', britain: 'the United Kingdom', 'great britain': 'the United Kingdom', england: 'the United Kingdom', 'united kingdom': 'the United Kingdom', uae: 'the United Arab Emirates', 'united arab emirates': 'the United Arab Emirates', netherlands: 'the Netherlands', philippines: 'the Philippines', maldives: 'the Maldives', bharat: 'India', hindustan: 'India', 'south korea': 'South Korea', 'north korea': 'North Korea' };
const SMALL = new Set(['of', 'and', 'the', 'da', 'de', 'del']);
const titleCase = (s: string) => s.split(' ').map((w, i) => (i && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
/** the place a national office belongs to: "… of Japan", "Japan's …", "Indian …" */
function country(text: string, officeAt: number, officeLen: number): string | null {
  const after = /^\s+of\s+(the\s+)?([a-z][a-z .'&-]{1,40}?)\s*(?=$|[?,.!]|\b(now|right now|today|currently|at present|these days|please|as of)\b)/i.exec(text.slice(officeAt + officeLen));
  let place = after?.[2]?.trim() ?? null;
  if (!place) { const poss = /([A-Za-z][A-Za-z .&-]{1,30}?)(?:'s|’s)\s+(?:current\s+|present\s+|new\s+)?$/i.exec(text.slice(0, officeAt)); place = poss?.[1]?.trim().split(/\s+/).slice(-3).join(' ') ?? null; if (place) place = place.replace(/^(who|what|is|are|the|and|tell|me|name|about)\s+/gi, '').replace(/^(who|what|is|are|the)\s+/gi, ''); }
  if (!place && /\bindian\s+(?:\w+\s+)?$/i.test(text.slice(0, officeAt))) place = 'India';
  if (!place) return null;
  const key = place.toLowerCase().replace(/\s+/g, ' ');
  if (COUNTRY_ALIAS[key]) return COUNTRY_ALIAS[key];
  if (!/^[a-z .'&-]+$/i.test(place) || /\b(this|that|my|our|your|a|an|company|school|team|class|club|family|house)\b/i.test(place)) return null;
  return titleCase(place);
}

export interface OfficePlan {
  /** Wikipedia page titles of the offices to look up (redirects are followed) */
  titles: string[];
  /** label → title, for a list across India (one entry per state / union territory) */
  bulk?: { label: string; title: string }[];
  /** what the list is, e.g. "Chief ministers of India's states and union territories" */
  heading?: string;
  /** the overview page a list answer links to */
  listUrl?: string;
  /** how to name the office in the answer, when the page title is a list ("Education Minister of Bihar") */
  label?: string;
}
/** state cabinet portfolios ("education minister of Bihar", "Bihar's minister of education") → Wikipedia's list of that state's ministers */
const PORTFOLIO = /\b(education|health|finance|home|agriculture)\s+ministers?\b|\bministers?\s+(?:of|for)\s+(education|health|finance|home|agriculture)\b/i;
/** If the question asks who CURRENTLY holds a public office (in India or any country), the office pages to look up. */
export function officeLookup(text: string): OfficePlan | null {
  const t = text.slice(0, 400);
  if (NOT_CURRENT.test(t)) return null;
  const pm = PORTFOLIO.exec(t); const pr = pm ? findRegion(t) : null;
  if (pm && pr) { const dept = (pm[1] ?? pm[2]).toLowerCase(); const place = pr.wiki ?? pr.name; return { titles: [`List of ministers of ${dept} of ${place}`], label: `${dept.charAt(0).toUpperCase() + dept.slice(1)} Minister of ${place}` }; }
  for (const o of OFFICES) {
    const m = o.re.exec(t); if (!m) continue;
    const region = findRegion(t);
    if (o.kind !== 'national') {
      if (region) {
        // a union territory without a chief minister is headed by its lieutenant governor / administrator
        const title = o.kind === 'cm' && region.cm ? `Chief Minister of ${region.wiki ?? region.name}` : `${region.head} of ${region.wiki ?? region.name}`;
        return { titles: [title] };
      }
      const plural = /s$/i.test(m[0]) && !/^cms?$/i.test(m[0]) || /\bcms\b/i.test(m[0]);
      if ((plural || ALL.test(t)) && (/\bindia(n)?\b/i.test(t) || ALL.test(t))) {
        const bulk = o.kind === 'cm' ? INDIA.filter((r) => r.cm).map((r) => ({ label: r.name, title: `Chief Minister of ${r.wiki ?? r.name}` })) : INDIA.map((r) => ({ label: r.name, title: `${r.head} of ${r.wiki ?? r.name}` }));
        return { titles: bulk.map((b) => b.title), bulk, heading: o.kind === 'cm' ? "Current chief ministers of India's states and union territories" : "Current governors, lieutenant governors and administrators of India's states and union territories",
          listUrl: o.kind === 'cm' ? 'https://en.wikipedia.org/wiki/List_of_current_Indian_chief_ministers' : 'https://en.wikipedia.org/wiki/List_of_current_Indian_governors' };
      }
      const c = country(t, m.index, m[0].length);   // "governor of California", "chief minister of Sindh"
      return c ? { titles: [`${o.title} of ${c}`] } : null;
    }
    if (region && !/\bindia\b/i.test(t)) return null;   // "president of Bihar …": not an office; leave it to the search
    const c = country(t, m.index, m[0].length);
    return c ? { titles: [`${o.title} of ${c}`] } : null;
  }
  // "who leads / heads / rules Japan", "leader of France": both national offices
  const lead = /\b(?:leader|head of (?:state|government)|ruler)\s+of\s+(the\s+)?([a-z][a-z .'&-]{1,40}?)\s*(?=$|[?,.!]|\b(now|today|currently)\b)/i.exec(t);
  if (lead) { const key = lead[2].trim().toLowerCase(); const c = COUNTRY_ALIAS[key] ?? titleCase(lead[2].trim()); return { titles: [`President of ${c}`, `Prime Minister of ${c}`] }; }
  return null;
}

/** A short, stable reference block for questions about India's states and territories (no officeholders). */
export function indiaDirectoryBlock(text: string): string {
  if (!/\b(states?|union territor(y|ies)|uts?|capitals?)\b/i.test(text) || !(/\bindia(n)?\b/i.test(text) || findRegion(text))) return '';
  const st = INDIA.filter((r) => r.kind === 'state'), ut = INDIA.filter((r) => r.kind === 'ut');
  return `INDIA DIRECTORY (stable reference kept by the app; it lists no officeholders — those are only ever taken from live sources):\n${st.length} states — ${st.map((r) => `${r.name} (${r.capital})`).join('; ')}.\n${ut.length} union territories — ${ut.map((r) => `${r.name} (${r.capital}; ${r.cm ? 'has a chief minister; ' : ''}${r.head})`).join('; ')}.`;
}
