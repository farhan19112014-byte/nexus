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

  /** Feed a chunk; returns newly visible text and whether the head was just parsed. */
  feed(chunk: string): { delta: string; headParsed: boolean } {
    this.buf += chunk;
    let headParsed = false;
    if (this.state === 'head') {
      const trimmed = this.buf.replace(/^\s+/, '');
      if (!trimmed.length) return { delta: '', headParsed };
      if (!'HEAD '.startsWith(trimmed.slice(0, 5)) && !trimmed.startsWith('HEAD')) { this.state = 'text'; this.buf = trimmed; }
      else {
        const nl = trimmed.indexOf('\n');
        if (nl < 0 && trimmed.length < 800) return { delta: '', headParsed };
        const line = nl < 0 ? trimmed : trimmed.slice(0, nl);
        try { this.head = JSON.parse(line.replace(/^HEAD\s*/, '')); headParsed = true; }
        catch (e) { this.headError = (e as Error).message; }
        this.buf = nl < 0 ? '' : trimmed.slice(nl + 1).replace(/^\s*\n?/, '');
        this.state = 'text';
      }
    }
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
    if (this.state !== 'meta' && this.buf) { this.text += this.buf; this.buf = ''; }
    return { head: this.head, headError: this.headError, text: this.text.trim(), metaRaw: this.state === 'meta' ? this.meta.trim() : null };
  }
}
