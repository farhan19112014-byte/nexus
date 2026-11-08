/**
 * Asset 43/48 — incremental parser for the streaming output contract:
 *
 *   HEAD {"expression":"happy","gesture":"wave","pose":"neutral","speakingStyle":"warm","emotionIntensity":0.7}
 *   <reply text, streamed to the user as it arrives…>
 *   <<<META>>>
 *   {"actions":[…],"memoryCandidates":[…],"skillProposal":null,…}
 *
 * HEAD and META are optional; anything that does not follow the contract is treated as reply text.
 * The marker is never leaked into the visible text even when split across chunks.
 */
export const META_MARKER = '<<<META>>>';

export interface StreamParse { head: unknown | null; headError: string | null; text: string; metaRaw: string | null }

export class StreamParser {
  private buf = '';
  private state: 'head' | 'text' | 'meta' = 'head';
  private text = '';
  private meta = '';
  head: unknown | null = null;
  headError: string | null = null;
  private leadNl = false;

  /** Feed a chunk; returns newly visible text and whether the head was just parsed. */
  feed(chunk: string): { delta: string; headParsed: boolean } {
    this.buf += chunk;
    let headParsed = false;
    if (this.state === 'head') {
      const trimmed = this.buf.replace(/^\s+/, '');
      if (!trimmed.length) return { delta: '', headParsed };
      // the head line is "HEAD" + optional spaces + a JSON object; a reply that merely starts with the word HEAD
      // ("HEADS UP", "HEAD office …") is reply text
      const couldBeHead = /^HEAD\s*\{/.test(trimmed) || /^(?:H|HE|HEA|HEAD\s*)$/.test(trimmed);   // complete head, or still too short to tell
      if (!couldBeHead) { this.state = 'text'; this.buf = trimmed; }
      else {
        // the head ends where its JSON object closes — some models continue the reply on the same line
        const end = headEnd(trimmed);
        if (end < 0) {
          const nl = trimmed.indexOf('\n');
          if (nl < 0 && trimmed.length < 800) return { delta: '', headParsed };   // not complete yet
          // never closes: an unusable head line is dropped (reported), the rest is the reply
          this.headError = 'the HEAD line is not a complete JSON object';
          this.buf = nl < 0 ? '' : trimmed.slice(nl + 1).replace(/^\s*\n?/, '');
        } else {
          try { this.head = JSON.parse(trimmed.slice(trimmed.indexOf('{'), end)); headParsed = true; }
          catch (e) { this.headError = (e as Error).message; }
          this.buf = trimmed.slice(end).replace(/^[ \t]*\r?\n?/, '').replace(/^\s*\n/, '');
          this.leadNl = !this.buf;   // the line break after the head may come in the next chunk
        }
        this.state = 'text';
      }
    }
    if (this.leadNl && this.state === 'text' && this.buf) { this.buf = this.buf.replace(/^[ \t]*\r?\n/, ''); this.leadNl = false; }
    if (this.state === 'meta') { this.meta += this.buf; this.buf = ''; return { delta: '', headParsed }; }
    // text state: emit everything except a possible partial marker at the end
    const idx = this.buf.indexOf(META_MARKER);
    if (idx >= 0) {
      const visible = this.buf.slice(0, idx);
      this.meta += this.buf.slice(idx + META_MARKER.length);
      this.buf = ''; this.state = 'meta';
      this.text += visible;
      return { delta: visible, headParsed };
    }
    let keep = 0;
    for (let k = Math.min(META_MARKER.length - 1, this.buf.length); k > 0; k--) if (META_MARKER.startsWith(this.buf.slice(-k))) { keep = k; break; }
    const visible = this.buf.slice(0, this.buf.length - keep);
    this.buf = this.buf.slice(this.buf.length - keep);
    this.text += visible;
    return { delta: visible, headParsed };
  }

  end(): StreamParse {
    // the stream ended while the head was still incomplete: never show the raw HEAD line as reply text
    if (this.state === 'head') { const t = this.buf.replace(/^\s+/, ''); if (/^HEAD\s*\{/.test(t) || /^(?:H|HE|HEA|HEAD\s*)$/.test(t)) { this.headError ??= 'the reply ended inside the HEAD line'; this.buf = ''; } this.state = 'text'; }
    if (this.state !== 'meta' && this.buf) { this.text += this.buf; this.buf = ''; }
    return { head: this.head, headError: this.headError, text: this.text.trim(), metaRaw: this.state === 'meta' ? this.meta.trim() : null };
  }
}

/** Index just after the HEAD line's JSON object (strings and nesting respected), or -1 while it is not complete. */
export function headEnd(s: string): number {
  const start = s.indexOf('{'); if (start < 0) return -1;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}
