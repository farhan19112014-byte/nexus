/**
 * Safe Markdown for model replies. A small parser turns text into React elements — never HTML strings,
 * never dangerouslySetInnerHTML — so model output can format text but cannot inject markup or scripts.
 * Supported: paragraphs, line breaks, **bold**, *italic*, `code`, fenced code blocks (with copy),
 * - / * / 1. lists, > quotes, #–### headings (rendered small), [links](https://…) and bare https:// URLs.
 * Links are allowed only for http(s); everything else renders as plain text. Works on partial (streaming) text.
 */
import { Fragment, useState, type ReactNode } from 'react';

export type Block =
  | { t: 'p'; text: string }
  | { t: 'h'; level: 1 | 2 | 3; text: string }
  | { t: 'code'; lang: string; text: string; open: boolean }
  | { t: 'ul' | 'ol'; items: string[]; start: number }
  | { t: 'quote'; text: string };

const FENCE = /^\s*(?:```+|~~~+)\s*([\w+#.-]{0,20})[^`]*$/;
const FENCE_CLOSE = /^\s*(?:```+|~~~+)\s*$/;
const ONE_LINE_FENCE = /^\s*```+([^`].*?)```+\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const UL = /^\s*[-*+]\s+/;
const OL = /^\s*(\d{1,4})[.)]\s+/;
const QUOTE = /^\s*>/;
const isBlockStart = (l: string) => ONE_LINE_FENCE.test(l) || FENCE.test(l) || HEADING.test(l) || UL.test(l) || OL.test(l) || QUOTE.test(l);

/** Splits markdown into blocks. An unterminated ``` fence (still streaming) becomes an open code block. */
export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const one = ONE_LINE_FENCE.exec(line);
    if (one) { out.push({ t: 'code', lang: '', text: one[1], open: false }); i++; continue; }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = []; i++;
      while (i < lines.length && !FENCE_CLOSE.test(lines[i])) body.push(lines[i++]);
      const open = i >= lines.length; i++;
      out.push({ t: 'code', lang: fence[1] ?? '', text: body.join('\n'), open });
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const h = HEADING.exec(line);
    if (h) { out.push({ t: 'h', level: Math.min(3, h[1].length) as 1 | 2 | 3, text: h[2] }); i++; continue; }
    if (UL.test(line)) {
      const items: string[] = [];
      while (i < lines.length && UL.test(lines[i])) items.push(lines[i++].replace(UL, ''));
      out.push({ t: 'ul', items, start: 1 }); continue;
    }
    const ol = OL.exec(line);
    if (ol) {
      const items: string[] = []; const start = Number(ol[1]);
      while (i < lines.length && OL.test(lines[i])) items.push(lines[i++].replace(OL, ''));
      out.push({ t: 'ol', items, start }); continue;
    }
    if (QUOTE.test(line)) {
      const q: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push({ t: 'quote', text: q.join('\n') }); continue;
    }
    // paragraph: runs until a blank line or a line that one of the parsers above would take.
    // The first line is always consumed, so the loop can never stall (no infinite loop on odd input).
    const para: string[] = [lines[i++]];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) para.push(lines[i++]);
    out.push({ t: 'p', text: para.join('\n') });
  }
  return out;
}

export const safeHref = (u: string): string | null => { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; } };

/** Inline formatting → React nodes. Order: code spans first (their content is literal), then links, bold, italic. */
export function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`\n]+`)|\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)|(\bhttps?:\/\/[^\s<>()]{2,500}[^\s<>().,;:!?'"])|(\*\*[^*\n]+\*\*|(?<!\w)__[^_\n]+__(?!\w))|(\*[^*\s][^*\n]*\*|(?<!\w)_[^_\s][^_\n]*_(?!\w))/g;
  let last = 0; let m: RegExpExecArray | null; let n = 0;
  const pushText = (s: string) => { const parts = s.split('\n'); parts.forEach((p, j) => { if (j) out.push(<br key={`${key}-br${n++}`} />); if (p) out.push(p); }); };
  while ((m = re.exec(text))) {
    if (m.index > last) pushText(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<code key={k}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) { const href = safeHref(m[3]); out.push(href ? <a key={k} href={href} target="_blank" rel="noopener noreferrer">{inline(m[2], k)}</a> : `${m[2]} (${m[3]})`); }
    else if (m[4]) { const href = safeHref(m[4]); out.push(href ? <a key={k} href={href} target="_blank" rel="noopener noreferrer">{m[4]}</a> : m[4]); }
    else if (m[5]) out.push(<strong key={k}>{inline(m[5].slice(2, -2), k)}</strong>);
    else if (m[6]) out.push(<em key={k}>{inline(m[6].slice(1, -1), k)}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) pushText(text.slice(last));
  return out;
}

function CodeBlock({ b }: { b: Extract<Block, { t: 'code' }> }) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  const copy = async () => {
    try { await navigator.clipboard.writeText(b.text); setCopied('ok'); } catch { setCopied('fail'); }
    setTimeout(() => setCopied('idle'), 1600);
  };
  return (
    <div className="md-code">
      <div className="md-code-bar"><span>{b.lang || 'code'}{b.open ? ' · streaming…' : ''}</span><button className="link" onClick={() => void copy()} aria-label="Copy code">{copied === 'ok' ? 'Copied' : copied === 'fail' ? 'Copy failed' : 'Copy'}</button></div>
      <pre><code>{b.text}</code></pre>
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.t) {
          case 'p': return <p key={k}>{inline(b.text, k)}</p>;
          case 'h': { const H = (`h${b.level + 2}`) as 'h3' | 'h4' | 'h5'; return <H key={k}>{inline(b.text, k)}</H>; }
          case 'code': return <CodeBlock key={k} b={b} />;
          case 'quote': return <blockquote key={k}>{inline(b.text, k)}</blockquote>;
          case 'ul': return <ul key={k}>{b.items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}</ul>;
          case 'ol': return <ol key={k} start={b.start}>{b.items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}</ol>;
          default: return <Fragment key={k} />;
        }
      })}
    </div>
  );
}
