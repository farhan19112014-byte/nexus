/**
 * Draws an AI-generated diagram spec (shared/visual.ts) as SVG. The model only supplies validated data — labels,
 * counts, directions — and this component does all the drawing, so nothing the model writes is ever executed or
 * injected as markup (React escapes every label). Colours are theme tokens, so diagrams follow light/dark and the
 * Colour Studio. 640 × 400 viewBox, scales to the panel.
 */
import type { ReactNode } from 'react';
import type { Diagram } from '../../shared/visual';

const W = 640, H = 400;
/** wrap a label into at most `lines` lines of about `max` characters */
export function wrap(s: string, max = 14, lines = 2): string[] {
  const words = s.split(/\s+/); const out: string[] = []; let cur = '';
  for (const w of words) {
    if (!cur) cur = w; else if ((cur + ' ' + w).length <= max) cur += ' ' + w; else { out.push(cur); cur = w; }
    if (out.length === lines) break;
  }
  if (out.length < lines && cur) out.push(cur);
  const used = out.join(' ').length;
  if (used < s.length && out.length) { const l = out[out.length - 1]; out[out.length - 1] = (l.length <= max ? l : l.slice(0, Math.max(1, max - 1)).replace(/\s+$/, '')) + '…'; }
  return out.slice(0, lines);
}
function T({ x, y, s, max = 14, lines = 2, size = 13, cls = 'dg-label', anchor = 'middle' }: { x: number; y: number; s: string; max?: number; lines?: number; size?: number; cls?: string; anchor?: 'start' | 'middle' | 'end' }) {
  const ls = wrap(s, max, lines);
  return <text x={x} y={y - ((ls.length - 1) * size * 0.6)} className={cls} fontSize={size} textAnchor={anchor}>{ls.map((l, i) => <tspan key={i} x={x} dy={i ? size * 1.2 : 0}>{l}</tspan>)}</text>;
}
const arrowDefs = <defs><marker id="dg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" className="dg-arrowhead" /></marker></defs>;

function orbit(d: Extract<Diagram, { type: 'orbit' }>): ReactNode {
  const cx = W / 2, cy = 212, n = d.items.length;
  return <g>
    <circle cx={cx} cy={cy} r={30} className="dg-core" /><T x={cx} y={cy + 4} s={d.center.label} max={10} size={12} cls="dg-core-label" />
    {d.items.map((it, i) => {
      const rx = 62 + ((i + 1) / n) * 236, ry = rx * 0.4, a = -Math.PI / 2 + (i * 2.39996) % (Math.PI * 2);  // golden-angle spread: labels rarely collide
      const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
      return <g key={i}><ellipse cx={cx} cy={cy} rx={rx} ry={ry} className="dg-ring" />
        <circle cx={x} cy={y} r={6 + Math.min(5, it.label.length > 6 ? 3 : 1)} className="dg-node" /><T x={x} y={y - 14} s={it.label} max={12} lines={1} size={12} /></g>;
    })}
  </g>;
}
function network(d: Extract<Diagram, { type: 'network' }>): ReactNode {
  const L = d.layers, top = 70, bottom = 330;
  const xs = L.map((_, i) => 80 + (i * (W - 160)) / Math.max(1, L.length - 1));
  const pos = L.map((l, i) => Array.from({ length: l.size }, (_, j) => ({ x: xs[i], y: top + ((j + 0.5) * (bottom - top)) / l.size })));
  return <g>
    {pos.slice(0, -1).map((col, i) => col.flatMap((a, j) => pos[i + 1].map((b, k) => <line key={`${i}-${j}-${k}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="dg-edge" />)))}
    {pos.map((col, i) => col.map((p, j) => <circle key={`${i}-${j}`} cx={p.x} cy={p.y} r={11} className={i === 0 || i === pos.length - 1 ? 'dg-node dg-node-io' : 'dg-node'} />))}
    {L.map((l, i) => <T key={i} x={xs[i]} y={362} s={l.label} max={12} lines={1} size={13} />)}
  </g>;
}
function boxes(items: { label: string; note?: string }[], y: number) {
  const n = items.length, gap = 14, bw = Math.min(150, (W - 40 - gap * (n - 1)) / n), x0 = (W - (bw * n + gap * (n - 1))) / 2;
  return items.map((it, i) => ({ ...it, x: x0 + i * (bw + gap), y, w: bw }));
}
function flow(d: Extract<Diagram, { type: 'flow' }>): ReactNode {
  const b = boxes(d.steps, 160);
  return <g>{arrowDefs}
    {b.map((s, i) => <g key={i}>
      <rect x={s.x} y={s.y} width={s.w} height={64} rx={12} className="dg-box" />
      <text x={s.x + 12} y={s.y + 18} className="dg-step" fontSize={10}>{i + 1}</text>
      <T x={s.x + s.w / 2} y={s.y + 38} s={s.label} max={Math.max(8, Math.floor(s.w / 8))} size={13} />
      {s.note && <T x={s.x + s.w / 2} y={s.y + 92} s={s.note} max={Math.max(8, Math.floor(s.w / 6.5))} lines={3} size={11} cls="dg-note" />}
      {i < b.length - 1 && <line x1={s.x + s.w + 2} y1={s.y + 32} x2={b[i + 1].x - 3} y2={s.y + 32} className="dg-arrow" markerEnd="url(#dg-arrow)" />}
    </g>)}
  </g>;
}
function cycle(d: Extract<Diagram, { type: 'cycle' }>): ReactNode {
  const cx = W / 2, cy = 205, R = 132, n = d.steps.length;
  const p = d.steps.map((s, i) => { const a = -Math.PI / 2 + (i / n) * Math.PI * 2; return { ...s, a, x: cx + Math.cos(a) * R * 1.45, y: cy + Math.sin(a) * R }; });
  return <g>{arrowDefs}
    <ellipse cx={cx} cy={cy} rx={R * 1.45} ry={R} className="dg-ring" />
    {p.map((s, i) => { const a0 = s.a + 0.32, a1 = p[(i + 1) % n].a - 0.32 + (i === n - 1 ? Math.PI * 2 : 0);
      const x0 = cx + Math.cos(a0) * R * 1.45, y0 = cy + Math.sin(a0) * R, x1 = cx + Math.cos(a1) * R * 1.45, y1 = cy + Math.sin(a1) * R;
      return <path key={`a${i}`} d={`M${x0} ${y0} A${R * 1.45} ${R} 0 0 1 ${x1} ${y1}`} className="dg-arrow" markerEnd="url(#dg-arrow)" />; })}
    {p.map((s, i) => <g key={i}><rect x={s.x - 62} y={s.y - 22} width={124} height={44} rx={22} className="dg-box" /><T x={s.x} y={s.y + 5} s={s.label} max={15} size={12} /></g>)}
    <T x={cx} y={cy + 4} s="repeats" max={10} size={11} cls="dg-note" />
  </g>;
}
function compare(d: Extract<Diagram, { type: 'compare' }>): ReactNode {
  const col = (c: { title: string; points: string[] }, x: number) => <g>
    <rect x={x} y={40} width={262} height={320} rx={16} className="dg-box" />
    <T x={x + 131} y={74} s={c.title} max={22} lines={1} size={16} cls="dg-title" />
    {c.points.map((pt, i) => <g key={i}><circle cx={x + 24} cy={116 + i * 50} r={4} className="dg-node" /><T x={x + 38} y={120 + i * 50} s={pt} max={28} lines={2} size={12} anchor="start" /></g>)}
  </g>;
  return <g>{col(d.left, 40)}{col(d.right, W - 40 - 262)}<circle cx={W / 2} cy={200} r={20} className="dg-core" /><text x={W / 2} y={205} className="dg-core-label" fontSize={13} textAnchor="middle">vs</text></g>;
}
function timeline(d: Extract<Diagram, { type: 'timeline' }>): ReactNode {
  const n = d.events.length, x0 = 50, x1 = W - 50, y = 205;
  return <g>{arrowDefs}<line x1={x0 - 20} y1={y} x2={x1 + 24} y2={y} className="dg-axis" markerEnd="url(#dg-arrow)" />
    {d.events.map((e, i) => { const x = x0 + (n === 1 ? 0 : (i * (x1 - x0)) / (n - 1)); const up = i % 2 === 0;
      return <g key={i}><line x1={x} y1={y - 8} x2={x} y2={y + 8} className="dg-axis" /><circle cx={x} cy={y} r={6} className="dg-node" />
        <T x={x} y={up ? y - 52 : y + 40} s={e.date} max={12} lines={1} size={13} cls="dg-title" />
        <T x={x} y={up ? y - 30 : y + 62} s={e.label} max={Math.max(10, Math.floor(560 / n / 7))} size={11} lines={2} /></g>; })}
  </g>;
}
function forces(d: Extract<Diagram, { type: 'forces' }>): ReactNode {
  const bx = W / 2, by = d.attractor ? 150 : 200, ax = W / 2, ay = 470;
  const dir = (k: string): [number, number] => k === 'up' ? [0, -1] : k === 'down' || k === 'toward' ? [0, 1] : k === 'left' ? [-1, 0] : k === 'right' ? [1, 0] : [0, -1];
  return <g>{arrowDefs}
    {d.attractor && <g><circle cx={ax} cy={ay} r={190} className="dg-core dg-planet" /><T x={ax} y={366} s={d.attractor.label} max={20} lines={1} size={14} cls="dg-core-label" /></g>}
    <circle cx={bx} cy={by} r={30} className="dg-node dg-body" /><T x={bx} y={by + 4} s={d.body.label} max={10} size={12} cls="dg-core-label" />
    {d.forces.map((f, i) => { const [ux, uy] = dir(f.direction); const len = 50 + f.strength * 70; const off = d.forces.length > 1 && (ux === 0) ? (i - (d.forces.length - 1) / 2) * 26 : 0;
      const sx = bx + ux * 34 + off, sy = by + uy * 34, ex = sx + ux * len, ey = sy + uy * len;
      // labels sit beside the middle of a vertical arrow, past the tip of a horizontal one — never on the bodies
      const lx = ux === 0 ? sx + 14 : ex + ux * 10, ly = ux === 0 ? (sy + ey) / 2 + 4 : ey - 12;
      return <g key={i}><line x1={sx} y1={sy} x2={ex} y2={ey} className="dg-arrow dg-force" markerEnd="url(#dg-arrow)" /><T x={lx} y={ly} s={f.label} max={22} lines={2} size={12} anchor={ux < 0 ? 'end' : 'start'} /></g>; })}
  </g>;
}
function hierarchy(d: Extract<Diagram, { type: 'hierarchy' }>): ReactNode {
  const b = boxes(d.children.map((c) => ({ label: c.label })), 160);
  return <g>
    <rect x={W / 2 - 90} y={36} width={180} height={50} rx={12} className="dg-box dg-root" /><T x={W / 2} y={66} s={d.root} max={20} lines={1} size={14} cls="dg-title" />
    {b.map((c, i) => <g key={i}><path d={`M${W / 2} 86 V118 H${c.x + c.w / 2} V160`} className="dg-edge dg-tree" />
      <rect x={c.x} y={c.y} width={c.w} height={46} rx={10} className="dg-box" /><T x={c.x + c.w / 2} y={c.y + 27} s={c.label} max={Math.max(8, Math.floor(c.w / 8))} size={12} />
      {d.children[i].children.map((g, j) => <T key={j} x={c.x + c.w / 2} y={c.y + 76 + j * 34} s={g} max={Math.max(8, Math.floor(c.w / 7))} lines={2} size={11} cls="dg-note" />)}</g>)}
  </g>;
}
function bars(d: Extract<Diagram, { type: 'bars' }>): ReactNode {
  const max = Math.max(...d.items.map((i) => i.value), 1e-9); const n = d.items.length; const rowH = Math.min(40, 300 / n);
  const fmt = (v: number) => (v >= 1e9 ? `${+(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${+(v / 1e3).toFixed(1)}k` : `${+v.toFixed(2)}`);
  return <g>{d.items.map((it, i) => { const y = 50 + i * rowH; const w = Math.max(4, (it.value / max) * 380);
    return <g key={i}><T x={150} y={y + rowH / 2 + 4} s={it.label} max={18} lines={1} size={12} anchor="end" /><rect x={162} y={y + 6} width={w} height={rowH - 14} rx={5} className="dg-bar" /><text x={170 + w} y={y + rowH / 2 + 4} className="dg-note" fontSize={11}>{fmt(it.value)}{d.unit ? ` ${d.unit}` : ''}</text></g>; })}</g>;
}

export function DiagramView({ diagram }: { diagram: Diagram }) {
  const body = diagram.type === 'orbit' ? orbit(diagram) : diagram.type === 'network' ? network(diagram) : diagram.type === 'flow' ? flow(diagram)
    : diagram.type === 'cycle' ? cycle(diagram) : diagram.type === 'compare' ? compare(diagram) : diagram.type === 'timeline' ? timeline(diagram)
    : diagram.type === 'forces' ? forces(diagram) : diagram.type === 'hierarchy' ? hierarchy(diagram) : bars(diagram);
  return <svg className={`diagram dg-${diagram.type}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${diagram.title} (diagram)`} data-diagram={diagram.type} preserveAspectRatio="xMidYMid meet">
    <title>{diagram.title}</title>{body}
  </svg>;
}
