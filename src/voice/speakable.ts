/**
 * Turns reply text into something worth saying aloud: no code, JSON, markdown symbols, raw links or citation marks.
 * The text on screen is unchanged — this only affects what the voice reads. Streamed replies arrive sentence by
 * sentence, so a code block can span several chunks: SpeakableFilter remembers whether it is inside one.
 */
const FENCE = /```/g;

/** Lines that look like JSON / data, or have almost no words, are not speech. */
function dropData(text: string): string {
  return text.split('\n').filter((l) => { const s = l.trim(); if (!s) return true; if (/^[{}[\]]/.test(s) && !/^\[[^\]]+\]\(/.test(s)) return false; if (/"[\w-]+"\s*:/.test(s)) return false; const letters = (s.match(/\p{L}/gu) ?? []).length; return letters >= 1 && !(s.length >= 12 && letters / s.length < 0.15); }).join('\n');
}

/** Clean one piece of text that is known not to be inside a code block. */
export function speakable(text: string): string {
  let t = dropData(text);
  t = t.replace(/`[^`\n]{1,200}`/g, (m) => { const inner = m.slice(1, -1); return /^[\w .-]{1,40}$/.test(inner) ? inner : ''; }); // short inline code: say the word; long: skip
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '');                          // images
  t = t.replace(/\[([^\]]{1,120})\]\((?:https?:|mailto:)[^)]*\)/g, '$1');  // [label](url) → label
  t = t.replace(/\bhttps?:\/\/\S+/g, 'the link on screen');
  t = t.replace(/\[(\d{1,2})\](?!\()/g, '');                             // citation marks [1]
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '');                              // headings
  t = t.replace(/^\s*[-*+]\s+/gm, '');                                   // bullets
  t = t.replace(/^\s*\d+[.)]\s+/gm, '');                                 // numbered lists
  t = t.replace(/^\s*>\s?/gm, '');                                       // quotes
  t = t.replace(/^\s*\|.*\|\s*$/gm, '');                                 // table rows
  t = t.replace(/(\*\*|__|~~)(.+?)\1/g, '$2').replace(/(^|\W)[*_](\S[^*_]*?)[*_](?=\W|$)/g, '$1$2');
  t = t.replace(/[*_#~|<>{}[\]\\]/g, ' ');
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  t = lines.length > 1 ? lines.map((l) => (/[.!?:;,…]$/.test(l) ? l : `${l}.`)).join(' ') : (lines[0] ?? '');   // list items / headings become short sentences
  return t.replace(/\s+([,.!?;:])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

export class SpeakableFilter {
  private inCode = false; private mentioned = false;
  reset() { this.inCode = false; this.mentioned = false; }
  /** Returns the speakable part of the next chunk ('' when nothing should be said). */
  next(chunk: string): string {
    const parts = chunk.split(FENCE); let out = '';
    parts.forEach((p, i) => {
      if (i > 0) this.inCode = !this.inCode;
      if (this.inCode) { if (!this.mentioned) { this.mentioned = true; out += ' The code is on screen. '; } return; }
      out += ` ${speakable(p)}`;
    });
    return out.replace(/\s{2,}/g, ' ').trim();
  }
}
