/**
 * Route "/studio" — the Colour Studio. Pick two colours (library or custom HEX), see the generated theme live in a
 * scoped preview, apply it to the whole of NEXUS, or go back to the original NEXUS colours.
 */
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, PATHS, useTitle } from '../router';
import { PRODUCT_NAME } from '../../shared/identity';
import { SitePage } from './Site';
import { Icon } from '../components/Icon';
import { COLOUR_LIBRARY, NEXUS_ACCENT, NEXUS_PRIMARY, contrastReport, generateTheme, type Palette } from '../theme/palette';
import { inkOn, normHex } from '../theme/colour';
import { currentPalette, onPaletteChange, samePalette, savePalette } from '../theme/studio';

type Slot = 0 | 1;
const SLOT_LABEL = ['Primary', 'Accent'] as const;
const SLOT_HINT = ['Buttons, deep tones and the tint of every surface', 'Glows, highlights, accent text and the main call to action'] as const;
const nameOf = (hex: string) => COLOUR_LIBRARY.find((c) => c.hex === hex)?.name ?? 'Custom colour';

export default function ColourStudio() {
  useTitle(`Colour Studio — ${PRODUCT_NAME}`);
  const [applied, setApplied] = useState<Palette | null>(currentPalette());
  const [pick, setPick] = useState<[string | null, string | null]>(() => { const p = currentPalette(); return p ? [p.a, p.b] : [null, null]; });
  const [active, setActive] = useState<Slot>(0);
  const [hex, setHex] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'bad' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => onPaletteChange(setApplied), []);

  const choose = (slot: Slot, value: string | null) => {
    const other = pick[slot === 0 ? 1 : 0];
    if (value && value === other) { setMsg({ kind: 'bad', text: 'That colour is already in the other slot — a theme needs two different colours.' }); return; }
    const next: [string | null, string | null] = [...pick]; next[slot] = value; setPick(next); setMsg(null);
    if (value && !next[slot === 0 ? 1 : 0]) setActive(slot === 0 ? 1 : 0); // fill the empty slot next
  };
  const onSwatch = (h: string) => {
    const at = pick.indexOf(h);
    if (at >= 0) { choose(at as Slot, null); setActive(at as Slot); return; } // clicking a chosen colour clears it
    choose(active, h);
  };
  const onCustom = (e: FormEvent) => {
    e.preventDefault();
    const h = normHex(hex);
    if (!h) { setMsg({ kind: 'bad', text: 'Enter a HEX colour such as #FF7A00 or #F70.' }); return; }
    choose(active, h); setHex('');
  };

  const complete = pick[0] && pick[1] ? { a: pick[0], b: pick[1] } : null;
  const pa = pick[0] ?? NEXUS_PRIMARY, pb = pick[1] ?? NEXUS_ACCENT;
  const theme = useMemo(() => generateTheme({ a: pa, b: pb }), [pa, pb]);
  const report = useMemo(() => contrastReport({ a: pa, b: pb }), [pa, pb]);
  const failing = report.filter((r) => !r.ok);
  const unchanged = samePalette(complete, applied);

  const apply = async () => {
    if (!complete) return;
    setBusy(true);
    try { await savePalette(complete); setMsg({ kind: 'ok', text: 'Theme applied to all of NEXUS and saved in this browser.' }); }
    catch (e) { setMsg({ kind: 'bad', text: `Applied to this page, but it could not be saved: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  };
  const reset = async () => {
    setBusy(true);
    try { await savePalette(null); setPick([null, null]); setActive(0); setMsg({ kind: 'ok', text: 'The original NEXUS colours are back.' }); }
    catch (e) { setMsg({ kind: 'bad', text: `Reset on this page, but it could not be saved: ${(e as Error).message}` }); }
    finally { setBusy(false); }
  };

  return (
    <SitePage className="studio-page">
      <div className="site-wrap studio" data-testid="colour-studio">
        <header className="studio-head">
          <p className="eyebrow">Colour Studio</p>
          <h1>Two colours. One {PRODUCT_NAME}.</h1>
          <p className="lead">Choose a primary and an accent. {PRODUCT_NAME} builds a complete theme from them — backgrounds, surfaces, borders, buttons,
            text and glows — keeping every text readable. NEXUS himself changes with it — body, face and lights.</p>
        </header>

        <div className="studio-grid">
          <section className="studio-pick" aria-label="Choose two colours">
            <div className="slots" role="radiogroup" aria-label="Which colour you are choosing">
              {([0, 1] as Slot[]).map((i) => {
                const h = pick[i];
                return (
                  <div key={i} className={`slot${active === i ? ' on' : ''}${h ? ' filled' : ''}`} data-testid={`slot-${i + 1}`}>
                    <button type="button" role="radio" aria-checked={active === i} className="slot-main flat" onClick={() => setActive(i)}>
                      <span className="slot-swatch" style={h ? { background: h } : undefined} aria-hidden>{!h && <Icon name="plus" size={18} />}</span>
                      <span className="slot-text">
                        <span className="slot-label">{i + 1} · {SLOT_LABEL[i]}</span>
                        <span className="slot-name">{h ? nameOf(h) : 'Choose a colour'}</span>
                        <code className="slot-hex" data-testid={`slot-${i + 1}-hex`}>{h ? h.toUpperCase() : '—'}</code>
                      </span>
                    </button>
                    {h && <button type="button" className="slot-clear" onClick={() => choose(i, null)} aria-label={`Clear colour ${i + 1}`} title="Clear"><Icon name="close" size={14} /></button>}
                    <p className="slot-hint">{SLOT_HINT[i]}</p>
                  </div>
                );
              })}
              <button type="button" className="btn swap" onClick={() => { setPick([pick[1], pick[0]]); setMsg(null); }} disabled={!pick[0] && !pick[1]} title="Swap primary and accent">⇄ Swap</button>
            </div>

            <h2 className="studio-h2">Colour library <span className="muted">{COLOUR_LIBRARY.length} colours · filling <b>{active + 1} · {SLOT_LABEL[active]}</b></span></h2>
            <div className="library" role="group" aria-label="Colour library" data-testid="colour-library">
              {COLOUR_LIBRARY.map((c) => {
                const at = pick.indexOf(c.hex);
                return (
                  <button key={c.hex} type="button" className={`swatch flat${at >= 0 ? ' chosen' : ''}`} style={{ '--sw': c.hex, '--sw-ink': inkOn(c.hex, '#0b0f17') } as CSSProperties}
                    aria-pressed={at >= 0} aria-label={`${c.name} ${c.hex.toUpperCase()}${at >= 0 ? `, colour ${at + 1}` : ''}`} title={`${c.name} · ${c.hex.toUpperCase()}`} onClick={() => onSwatch(c.hex)}>
                    <span className="sw-chip" aria-hidden>{at >= 0 && <b>{at + 1}</b>}</span>
                    <span className="sw-name">{c.name}</span>
                  </button>
                );
              })}
            </div>

            <form className="custom-hex" onSubmit={onCustom}>
              <label htmlFor="hex-in">Custom HEX colour</label>
              <div className="hex-row">
                <input type="color" aria-label="Pick a custom colour" value={normHex(hex) ?? pick[active] ?? '#1268f5'} onChange={(e) => setHex(e.target.value)} />
                <input id="hex-in" type="text" inputMode="text" autoComplete="off" spellCheck={false} maxLength={7} placeholder="#FF7A00" value={hex}
                  onChange={(e) => setHex(e.target.value)} aria-describedby="hex-help" data-testid="hex-input" />
                <button type="submit" className="btn" data-testid="hex-use">Use as {active + 1} · {SLOT_LABEL[active]}</button>
              </div>
              <p id="hex-help" className="small muted">#RGB or #RRGGBB. It goes into the highlighted slot.</p>
            </form>
          </section>

          <section className="studio-preview" aria-label="Live preview">
            <h2 className="studio-h2">Live preview {!complete && <span className="muted">{pick[0] || pick[1] ? '· missing colour shown as NEXUS default' : '· NEXUS default'}</span>}</h2>
            <div className="palette-scope preview" style={theme.vars as CSSProperties} data-testid="studio-preview">
              <div className="pv-nav"><span className="pv-logo">N E X U S</span><span className="pv-links"><i>Robot</i><i>HOLOBUILD</i><i>About</i></span><span className="pv-cta">Meet NEXUS</span></div>
              <div className="pv-hero">
                <p className="pv-eyebrow">01 · Robot</p>
                <p className="pv-title">Intelligence, <span>with a presence.</span></p>
                <p className="pv-lead">A companion that listens, thinks and speaks.</p>
                <div className="pv-btns"><span className="pv-btn-accent">Meet NEXUS</span><span className="pv-btn-primary">Send</span><span className="pv-btn-ghost">Learn more</span></div>
              </div>
              <div className="pv-cards">
                <div className="pv-card"><p className="pv-k">System</p><p><span className="pv-dot" /> NEXUS server <em>ONLINE</em></p><p className="pv-muted">Interaction · listening</p></div>
                <div className="pv-card"><p className="pv-k">Chat</p><p className="pv-bubble">How do rockets steer?</p><p className="pv-input">Message NEXUS…</p></div>
              </div>
              <div className="pv-gradient" aria-hidden />
            </div>
            <div className="pv-roles" aria-label="Generated colours">
              {([['Primary', theme.roles.primary], ['Accent', theme.roles.accent], ['Background', theme.roles.bgDark], ['Light bg', theme.roles.bgLight], ['Text', theme.roles.textDark], ['Text (light)', theme.roles.textLight]] as const).map(([k, v]) => (
                <span key={k} className="pv-role"><i style={{ background: v }} aria-hidden /> {k} <code>{v.toUpperCase()}</code></span>
              ))}
            </div>
            <details className="contrast" open={failing.length > 0}>
              <summary data-testid="contrast-summary">{failing.length ? `Readability: ${failing.length} pair${failing.length > 1 ? 's' : ''} below target` : `Readability: all ${report.length} text pairs meet WCAG AA`}</summary>
              <ul>{report.map((r) => <li key={r.label} className={r.ok ? 'ok' : 'bad'}><span>{r.label}</span> <b>{r.ratio.toFixed(1)}:1</b></li>)}</ul>
            </details>
          </section>
        </div>

        <div className="studio-actions">
          <p className={`studio-msg ${msg?.kind ?? ''}`} role="status" aria-live="polite" data-testid="studio-msg">
            {msg?.text ?? (complete ? (unchanged ? 'This is the theme in use.' : 'Ready — apply it to the whole site.') : `Choose ${pick[0] || pick[1] ? 'one more colour' : 'two colours'} to build a theme.`)}
          </p>
          <button type="button" className="btn" onClick={reset} disabled={busy || (!applied && !pick[0] && !pick[1])} data-testid="studio-reset">Reset to NEXUS default</button>
          <button type="button" className="btn btn-primary" onClick={apply} disabled={busy || !complete || unchanged} data-testid="studio-apply">Apply theme</button>
        </div>
        <p className="small muted studio-foot">Saved in this browser with your other settings. Change light/dark with the sun/moon button — the theme follows both. <Link to={PATHS.app}>Back to the robot</Link></p>
      </div>
    </SitePage>
  );
}
