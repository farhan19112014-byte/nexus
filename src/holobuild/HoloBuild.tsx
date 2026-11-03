/**
 * HOLOBUILD — NEXUS's 3D building and learning workspace.
 * Layout: top bar (title, model name, save, export, fullscreen, view settings) · left (examples, library, session,
 * history) · centre (3D viewport) · right (model, selected part, parts, assembly steps, facts) · bottom (command bar,
 * voice, status) with the NEXUS robot docked beside it — the same robot, voice and conversation as the main workspace.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { MATERIALS, MATERIAL_IDS, modelBounds, type HoloModel, type HoloPart } from '../../shared/holo';
import { Icon } from '../components/Icon';
import { ErrorBoundary } from '../components/ErrorBoundary';
import Stage from '../components/Stage';
import { ThemeToggle } from '../components/ThemeToggle';
import { StudioLink } from '../components/StudioLink';
import { companion, memory } from '../core/runtime';
import { useSnapshot, useStore } from '../components/hooks';
import { Link, PATHS, useTitle } from '../router';
import { Logo } from '../site/Site';
import { PRODUCT_NAME } from '../../shared/identity';
import { holo } from './instance';
import { HoloViewport, fmtLen } from './HoloViewport';
import { TEMPLATES } from './templates';

const ORIGIN_LABEL: Record<HoloModel['origin'], { text: string; title: string }> = {
  template: { text: 'NEXUS template', title: 'Built by NEXUS from a built-in procedural template (works offline).' },
  'ai-procedural': { text: 'AI-designed (procedural)', title: 'Designed by the connected AI model as a list of basic shapes, validated by NEXUS. An approximation, not a mesh from a 3D-generation service.' },
  imported: { text: 'Imported file', title: 'Loaded from a GLB/GLTF file you imported.' },
};
const EXAMPLES = [...TEMPLATES.filter((t) => t.id !== 'basic-shape').map((t) => ({ label: t.name, prompt: `build a ${t.name.toLowerCase()}` })), { label: 'Red cube', prompt: 'build a red cube' }];
const SUGGESTIONS = ['Make it twice as large', 'Show the internal structure', 'Explode it', 'Change the material to brushed aluminium', 'Make the roof taller', 'Remove the rear wheel', 'Undo'];

const useHolo = () => useSyncExternalStore(holo.subscribe, holo.getSnapshot);

export default function HoloBuild() {
  const s = useHolo(); const cs = useSnapshot(); useStore(memory);
  const settings = memory.settings;
  useTitle(`HOLOBUILD · ${PRODUCT_NAME}`);
  const root = useRef<HTMLDivElement>(null);
  const [cmd, setCmd] = useState('');
  const [confirmDel, setConfirmDel] = useState<HoloModel | null>(null);
  const [naming, setNaming] = useState(false);
  const [viewMenu, setViewMenu] = useState(false);
  const [collection, setCollection] = useState('');
  const fileIn = useRef<HTMLInputElement>(null);
  const cmdIn = useRef<HTMLInputElement>(null);

  useEffect(() => { void companion.init(); void holo.init(); }, []);
  // voice commands on this page go to HOLOBUILD first (questions still reach the normal conversation)
  useEffect(() => { companion.transcriptHandler = (t) => { void holo.command(t); return true; }; return () => { companion.transcriptHandler = null; }; }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) holo.redo(); else holo.undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void holo.save(); }
      else if (e.key === 'Escape' && !typing) { if (s.busy) holo.cancel(); else holo.select(null); }
      else if (e.key === '/' && !typing) { e.preventDefault(); cmdIn.current?.focus(); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [s.busy]);
  // leaving with unsaved changes: the browser asks
  useEffect(() => { const f = (e: BeforeUnloadEvent) => { if (s.dirty && s.model) { e.preventDefault(); } }; window.addEventListener('beforeunload', f); return () => window.removeEventListener('beforeunload', f); }, [s.dirty, s.model]);

  const run = async (text: string) => { const t = text.trim(); if (!t) return; setCmd(''); await holo.command(t); };
  const sel = s.model?.parts.find((p) => p.id === s.selected) ?? null;
  const collections = useMemo(() => [...new Set(s.saved.map((m) => m.collection).filter(Boolean))].sort(), [s.saved]);
  const library = s.saved.filter((m) => !collection || m.collection === collection);
  const lastReply = [...cs.messages].reverse().find((m) => m.role === 'assistant');
  const exportAs = async (binary: boolean) => {
    setViewMenu(false); const f = await holo.exportFile(binary); if (!f) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(f.data); a.download = f.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const onImport = async (file: File | undefined) => { if (!file) return; await holo.importFile(await file.arrayBuffer(), file.name); if (fileIn.current) fileIn.current.value = ''; };
  const fullscreen = () => { const el = root.current?.querySelector('.holo-center'); if (!document.fullscreenElement) void el?.requestFullscreen?.().catch(() => {}); else void document.exitFullscreen(); };
  const b = s.model ? modelBounds(s.model) : null;

  return (
    <div className={`app holo ${settings.highContrast ? 'hc' : ''} ${settings.largeText ? 'lt' : ''} ${settings.reducedMotion ? 'rm' : ''}`} ref={root}>
      <a className="skip" href="#holo-cmd">Skip to the command bar</a>
      <header className="top holo-top">
        <Link to={PATHS.home} className="brand" aria-label={`${PRODUCT_NAME} home page`}><Logo size={24} /><span>{PRODUCT_NAME}</span></Link>
        <span className="holo-title"><Icon name="cube" /> HOLOBUILD</span>
        {s.model && (naming
          ? <form className="holo-rename" onSubmit={(e) => { e.preventDefault(); const v = new FormData(e.currentTarget).get('name'); setNaming(false); void holo.rename(String(v ?? '')); }}>
              <input name="name" defaultValue={s.model.name} maxLength={60} aria-label="Model name" autoFocus onBlur={() => setNaming(false)} />
            </form>
          : <button className="holo-modelname" onClick={() => setNaming(true)} title="Rename the model" data-testid="holo-model-name">{s.model.name}{s.dirty ? <span className="holo-dirty" aria-label="unsaved changes"> •</span> : null}</button>)}
        <div className="holo-actions">
          <button className="btn" onClick={() => void holo.save()} disabled={!s.model} title="Save to your library (Ctrl+S)"><Icon name="save" /> Save</button>
          <div className="holo-menu-wrap">
            <button className="btn" onClick={() => setViewMenu((v) => !v)} aria-expanded={viewMenu} aria-haspopup="menu" title="Export, import and view settings"><Icon name="download" /> File & view</button>
            {viewMenu && <div className="holo-menu" role="menu">
              <button role="menuitem" disabled={!s.model} onClick={() => void exportAs(true)}>Export GLB (binary)</button>
              <button role="menuitem" disabled={!s.model} onClick={() => void exportAs(false)}>Export GLTF (JSON)</button>
              <button role="menuitem" onClick={() => { setViewMenu(false); fileIn.current?.click(); }}>Import GLB / GLTF…</button>
              <hr />
              <ViewToggles />
            </div>}
          </div>
          <button className="icon-btn" onClick={fullscreen} aria-label="Fullscreen viewport" title="Fullscreen viewport"><Icon name="expand" /></button>
          <StudioLink /><ThemeToggle />
          <Link to={PATHS.app} className="btn btn-ghost" title="Back to the robot workspace">Robot</Link>
        </div>
        <input ref={fileIn} type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" hidden onChange={(e) => void onImport(e.target.files?.[0])} data-testid="holo-import" />
      </header>

      <main className="holo-layout">
        <aside className="holo-left" aria-label="Library">
          <section>
            <h2>Examples <span className="muted">(built offline)</span></h2>
            <div className="holo-examples">{EXAMPLES.map((e) => <button key={e.label} className="chip" onClick={() => void run(e.prompt)}>{e.label}</button>)}</div>
          </section>
          <section>
            <h2>Saved models {collections.length > 0 && <select aria-label="Collection" value={collection} onChange={(e) => setCollection(e.target.value)}><option value="">All</option>{collections.map((c) => <option key={c}>{c}</option>)}</select>}</h2>
            {!library.length && <p className="muted">Nothing saved yet{s.saved.length ? ' in this collection' : ''}.</p>}
            <ul className="holo-list" data-testid="holo-saved">{library.map((m) => (
              <li key={m.id} className={s.model?.id === m.id ? 'on' : ''}>
                <button className="link" onClick={() => void holo.reopen(m.id)} title={`Open “${m.name}”`}>{m.name}</button>
                <span className="muted">{m.parts.length} parts{m.collection ? ` · ${m.collection}` : ''}</span>
                <button className="icon-btn" onClick={() => setConfirmDel(m)} aria-label={`Delete ${m.name}`} title="Delete"><Icon name="trash" /></button>
              </li>))}</ul>
          </section>
          {s.session.length > 0 && <section>
            <h2>This session <span className="muted">(not saved)</span></h2>
            <ul className="holo-list">{s.session.map((m) => <li key={m.id} className={s.model?.id === m.id ? 'on' : ''}><button className="link" onClick={() => holo.openSession(m.id)}>{m.name}</button><span className="muted">{ORIGIN_LABEL[m.origin].text}</span></li>)}</ul>
          </section>}
          {s.model && s.model.edits.length > 0 && <section>
            <h2>History</h2>
            <ol className="holo-history">{s.model.edits.slice(-12).map((e, i) => <li key={i}>{e}</li>)}</ol>
            <div className="row"><button className="btn btn-ghost" onClick={() => holo.undo()} disabled={!s.canUndo}><Icon name="undo" /> Undo</button><button className="btn btn-ghost" onClick={() => holo.redo()} disabled={!s.canRedo}><Icon name="redo" /> Redo</button></div>
          </section>}
          {s.model && <section>
            <h2>Collection</h2>
            <form className="row" onSubmit={(e) => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get('c') ?? ''); void holo.save({ collection: v }); }}>
              <input name="c" defaultValue={s.model.collection} key={s.model.id} maxLength={40} placeholder="e.g. Engines" aria-label="Collection name" list="holo-collections" />
              <datalist id="holo-collections">{collections.map((c) => <option key={c} value={c} />)}</datalist>
              <button className="btn">Save to</button>
            </form>
          </section>}
        </aside>

        <section className="holo-center" aria-label="3D viewport">
          <ErrorBoundary area="3D viewport"><HoloViewport ctl={holo} snap={s} reducedMotion={settings.reducedMotion} /></ErrorBoundary>
          <div className="holo-viewbar" role="toolbar" aria-label="View">
            <button onClick={() => holo.ui('reset-view')} title="Reset the camera"><Icon name="reset" /> Reset</button>
            <button aria-pressed={s.view.exploded} onClick={() => holo.setView({ exploded: !s.view.exploded })} disabled={!s.model}><Icon name="layers" /> {s.view.exploded ? 'Assemble' : 'Explode'}</button>
            {s.view.exploded && <label className="holo-slider">Distance <input type="range" min={0.1} max={1} step={0.05} value={s.view.explodeDistance} onChange={(e) => holo.setView({ explodeDistance: Number(e.target.value) })} /></label>}
            <button aria-pressed={s.view.projection === 'orthographic'} onClick={() => holo.setView({ projection: s.view.projection === 'orthographic' ? 'perspective' : 'orthographic' })}>{s.view.projection === 'orthographic' ? 'Orthographic' : 'Perspective'}</button>
            <button aria-pressed={s.view.wireframe} onClick={() => holo.setView({ wireframe: !s.view.wireframe })}>{s.view.wireframe ? 'Wireframe' : 'Solid'}</button>
            <button aria-pressed={s.view.labels} onClick={() => holo.setView({ labels: !s.view.labels })}>Labels</button>
            <button aria-pressed={s.view.measure} onClick={() => holo.setView({ measure: !s.view.measure })}>Measure</button>
          </div>
        </section>

        <aside className="holo-right" aria-label="Properties">
          {!s.model && <section><h2>Properties</h2><p className="muted">Build or open a model to see its parts, materials and dimensions.</p></section>}
          {s.model && <>
            <section>
              <h2>Model</h2>
              <p><span className={`badge origin-${s.model.origin}`} title={ORIGIN_LABEL[s.model.origin].title} data-testid="holo-origin">{ORIGIN_LABEL[s.model.origin].text}</span> <span className="muted">{s.model.category}</span></p>
              {s.model.description && <p>{s.model.description}</p>}
              {s.model.caveat && <p className="holo-caveat">{s.model.caveat}</p>}
              {b && <p className="muted">Size: {fmtLen(b.size[0])} × {fmtLen(b.size[1])} × {fmtLen(b.size[2])} (W × H × D){s.model.scale !== 1 ? ` · scale ×${+s.model.scale.toFixed(3)}` : ''}</p>}
            </section>
            {sel && <PartPanel part={sel} />}
            <section>
              <h2>Parts <span className="muted">({s.model.parts.length})</span></h2>
              <ul className="holo-parts" data-testid="holo-parts">{s.model.parts.map((p) => (
                <li key={p.id} className={p.id === s.selected ? 'on' : ''}>
                  <button className="link" onClick={() => holo.select(p.id === s.selected ? null : p.id)} aria-pressed={p.id === s.selected}>{p.name}</button>
                  {p.group && <span className="muted">{p.group}</span>}
                  <button className="icon-btn" onClick={() => holo.togglePart(p.id)} aria-label={`${p.visible ? 'Hide' : 'Show'} ${p.name}`} title={p.visible ? 'Hide' : 'Show'}><Icon name={p.visible ? 'eye' : 'close'} /></button>
                </li>))}</ul>
              {s.model.parts.some((p) => !p.visible) && <button className="btn btn-ghost" onClick={() => holo.apply([{ op: 'show', target: 'model' }], 'show everything')}>Show all parts</button>}
            </section>
            {s.model.steps.length > 0 && <section>
              <h2>Assembly steps</h2>
              <ol className="holo-steps">{s.model.steps.map((st, i) => <li key={i}><button className="link" onClick={() => holo.showStep(i)} title="Show the model as it is after this step"><strong>{st.title}</strong></button> {st.text}</li>)}</ol>
            </section>}
            {s.model.facts.length > 0 && <section><h2>Did you know?</h2><ul>{s.model.facts.map((f, i) => <li key={i}>{f}</li>)}</ul></section>}
          </>}
        </aside>
      </main>

      <footer className="holo-bottom">
        <div className="holo-robot" aria-label={`${settings.robotName}, your robot`}>
          <ErrorBoundary area="robot" compact><Stage compact /></ErrorBoundary>
          {(cs.activity || lastReply) && <div className="holo-bubble" role="status" aria-live="polite" data-testid="holo-bubble">
            {cs.activity ? <><span className="spinner" aria-hidden /> {cs.activity.kind === 'building' ? 'Building' : cs.activity.kind === 'editing' ? 'Editing' : cs.activity.kind === 'researching' ? 'Researching' : 'Reflecting'}: {cs.activity.label}</> : (lastReply!.text || (lastReply!.status === 'failed' ? lastReply!.error?.message : '…'))?.slice(0, 360)}
          </div>}
        </div>
        <div className="holo-command">
          {s.clarify && <div className="holo-clarify" role="alert">{s.clarify.message}{s.clarify.candidates.length > 0 && <div className="holo-examples">{s.clarify.candidates.slice(0, 8).map((id) => { const p = s.model?.parts.find((x) => x.id === id); return p ? <button key={id} className="chip" onClick={() => holo.select(id)}>{p.name}</button> : null; })}</div>}</div>}
          <form onSubmit={(e) => { e.preventDefault(); void run(cmd); }} className="holo-cmdrow">
            <input id="holo-cmd" ref={cmdIn} value={cmd} onChange={(e) => setCmd(e.target.value)} maxLength={400} autoComplete="off" placeholder={s.model ? 'Edit (“make the roof taller”), ask (“what does the camshaft do?”) or build something new' : 'Describe something to build — e.g. “build a suspension bridge”'} aria-label="HOLOBUILD command" />
            <button type="button" className={`mic-btn${cs.listening ? ' on' : ''}`} onClick={() => (cs.listening ? companion.stopListening() : companion.startListening())} aria-pressed={cs.listening} aria-label={cs.listening ? 'Stop listening' : 'Speak a command'} title="Voice command"><Icon name="mic" /></button>
            {s.busy ? <button type="button" className="btn" onClick={() => holo.cancel()}><Icon name="stop" /> Cancel</button> : <button className="btn btn-primary" disabled={!cmd.trim()}><Icon name="send" /> Go</button>}
          </form>
          {s.model && <div className="holo-suggest">{SUGGESTIONS.map((x) => <button key={x} className="chip" onClick={() => void run(x)}>{x}</button>)}</div>}
          <p className={`holo-status st-${s.status.kind}`} role="status" aria-live="polite" data-testid="holo-status">{cs.interim ? `“${cs.interim}”` : s.status.text}</p>
        </div>
      </footer>

      {confirmDel && <div className="holo-dialog-back" role="presentation" onClick={() => setConfirmDel(null)}>
        <div className="holo-dialog" role="alertdialog" aria-modal="true" aria-labelledby="holo-del-title" onClick={(e) => e.stopPropagation()}>
          <h2 id="holo-del-title">Delete “{confirmDel.name}”?</h2>
          <p>This removes it from your library{confirmDel.origin === 'imported' ? ' together with the imported file' : ''}. It cannot be undone.</p>
          <div className="row"><button className="btn" autoFocus onClick={() => setConfirmDel(null)}>Keep it</button><button className="btn btn-danger" onClick={() => { void holo.remove(confirmDel.id); setConfirmDel(null); }} data-testid="holo-confirm-delete">Delete</button></div>
        </div>
      </div>}
    </div>
  );
}

function ViewToggles() {
  const s = useHolo();
  const t = (k: 'grid' | 'axes' | 'labels' | 'measure', label: string) => <label className="holo-check"><input type="checkbox" checked={s.view[k]} onChange={(e) => holo.setView({ [k]: e.target.checked })} /> {label}</label>;
  return <>{t('grid', 'Grid')}{t('axes', 'Axes')}{t('labels', 'Part labels')}{t('measure', 'Dimensions')}</>;
}

function PartPanel({ part }: { part: HoloPart }) {
  const s = useHolo();
  const explain = () => { void holo.command(`Explain what the ${part.name} does and how it connects to the parts around it.`); };
  return (
    <section className="holo-part" data-testid="holo-part">
      <h2>{part.name}</h2>
      {part.description && <p>{part.description}</p>}
      <dl className="holo-props">
        {part.group && <><dt>Group</dt><dd>{part.group}</dd></>}
        <dt>Shape</dt><dd>{part.shape}</dd>
        <dt>Size</dt><dd>{part.size.map((v) => fmtLen(v * (s.model?.scale ?? 1))).join(' × ')}</dd>
        <dt>Material</dt><dd>
          <select aria-label={`Material of ${part.name}`} value={part.material} onChange={(e) => holo.apply([{ op: 'material', target: part.id, material: e.target.value as HoloPart['material'] }], `${part.name}: ${MATERIALS[e.target.value as HoloPart['material']].label}`)}>
            {MATERIAL_IDS.map((m) => <option key={m} value={m}>{MATERIALS[m].label}</option>)}
          </select>
        </dd>
        <dt>Colour</dt><dd><input type="color" aria-label={`Colour of ${part.name}`} value={part.color ?? MATERIALS[part.material].color} onChange={(e) => holo.apply([{ op: 'color', target: part.id, color: e.target.value }], `${part.name}: colour ${e.target.value}`)} /></dd>
        <dt>Opacity</dt><dd><input type="range" min={0.1} max={1} step={0.05} value={part.opacity} aria-label={`Opacity of ${part.name}`} onChange={(e) => holo.apply([{ op: 'opacity', target: part.id, value: Number(e.target.value) }], `${part.name}: opacity ${e.target.value}`)} /></dd>
      </dl>
      <div className="row wrap">
        <button className="btn" onClick={explain} title="Ask NEXUS to explain this part"><Icon name="chat" /> Explain</button>
        <button className="btn btn-ghost" onClick={() => holo.apply([{ op: 'isolate', target: part.id }], `isolate ${part.name}`)}>Isolate</button>
        <button className="btn btn-ghost" onClick={() => holo.apply([{ op: part.visible ? 'hide' : 'show', target: part.id }], `${part.visible ? 'hide' : 'show'} ${part.name}`)}>{part.visible ? 'Hide' : 'Show'}</button>
        <button className="btn btn-ghost" onClick={() => holo.select(null)}>Deselect</button>
      </div>
    </section>
  );
}
