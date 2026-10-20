/** Assets 52–60 — inspect, edit, delete, resolve conflicts, consent to suggestions, import/export, boundaries. */
import { useRef, useState } from 'react';
import { companion, memory } from '../core/runtime';
import { download, fmtDate, useStore } from './hooks';
import { MEMORY_CATEGORIES } from '../../shared/schema';

export default function MemoryPanel() {
  useStore(memory);
  const [text, setText] = useState(''); const [cat, setCat] = useState<(typeof MEMORY_CATEGORIES)[number]>('fact');
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null); const [wipeAsk, setWipeAsk] = useState(false);
  const [msg, setMsg] = useState('');
  const [showOld, setShowOld] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const s = memory.settings;
  const guard = async (f: () => Promise<unknown>) => { try { await f(); } catch (e) { setMsg((e as Error).message); } };
  const items = memory.items.filter((m) => showOld || m.status === 'active').sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div className="memory">
      <label className="toggle"><input type="checkbox" checked={s.memoryEnabled} onChange={(e) => void guard(() => memory.updateSettings({ memoryEnabled: e.target.checked }))} /> Persistent memory on</label>
      <details className="card boundaries">
        <summary>What is stored where? (Asset 58)</summary>
        <ul className="small">
          <li><b>Session context</b> — this conversation, kept in this tab only; the most recent messages (Settings → history) are sent with each request.</li>
          <li><b>Persistent memory</b> — the items below, stored on this computer (IndexedDB), only after an explicit request or your approval. Deleting removes the record.</li>
          <li><b>Provider-side history</b> — the AI provider receives the messages and relevant memories sent with each request; its retention is governed by that provider's policy.</li>
          <li><b>Retrieved information</b> — research sources are fetched per message and shown with the reply; they are not saved to memory.</li>
          <li><b>Skills</b> — approved motions/expressions live in a separate registry. None of this trains the AI model.</li>
        </ul>
      </details>
      {memory.suggestions.length > 0 && <>
        <h4>Waiting for your consent ({memory.suggestions.length})</h4>
        <ul className="mem-list">{memory.suggestions.map((x) => <li key={x.id}><span>“{x.text}” <span className="muted">{x.category}{x.reason ? ` — ${x.reason}` : ''}</span></span><span className="spacer" /><button className="primary" onClick={() => void companion.acceptSuggestion(x.id)}>Save</button><button onClick={() => memory.dismissSuggestion(x.id)}>Dismiss</button></li>)}</ul>
      </>}
      {memory.conflicts.length > 0 && <>
        <h4>Conflicts to resolve</h4>
        <ul className="mem-list">{memory.conflicts.map((c, i) => <li key={i} className="col"><span>New: “{c.newer.text}”</span><span>Saved: “{c.older.text}” ({c.older.source}, {fmtDate(c.older.updatedAt)})</span><span className="row"><button onClick={() => void guard(() => memory.resolveConflict(i, 'newer'))}>Keep new</button><button onClick={() => void guard(() => memory.resolveConflict(i, 'older'))}>Keep saved</button></span></li>)}</ul>
      </>}
      <h4>Saved memories ({memory.active().length}) <label className="toggle small"><input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} /> show superseded</label></h4>
      {!items.length && <p className="muted">Nothing saved yet. Say “remember that …” or add one below.</p>}
      <ul className="mem-list">
        {items.map((m) => (
          <li key={m.id} className={`col ${m.status}`}>
            {edit?.id === m.id
              ? <span className="row"><input value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} aria-label="Edit memory" maxLength={200} /><button onClick={() => void guard(async () => { if (!(await memory.edit(m.id, edit.text))) setMsg('Not saved (empty or looks sensitive).'); setEdit(null); })}>Save</button></span>
              : <span><b>{m.text}</b> <span className={`badge b-${m.status === 'active' ? 'approved' : 'deprecated'}`}>{m.category}{m.status === 'superseded' ? ' · superseded' : ''}</span></span>}
            <span className="muted small">Why: {m.reason || '—'} · source: {m.source.replace('_', ' ')} · saved {fmtDate(m.createdAt)} · updated {fmtDate(m.updatedAt)}{m.lastUsedAt ? ` · last used ${fmtDate(m.lastUsedAt)}` : ''}{m.key ? ` · key ${m.key}` : ''}</span>
            <span className="row">{m.status === 'active' && <button className="link" onClick={() => setEdit({ id: m.id, text: m.text })}>edit</button>}<button className="link danger" onClick={() => void guard(() => memory.forget(m.id))}>delete</button></span>
          </li>
        ))}
      </ul>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void memory.remember({ text, category: cat, reason: 'added manually', explicit: true }, 'manual').then((r) => { setMsg(r.message); if (r.status === 'saved') setText(''); }); }}>
        <select value={cat} onChange={(e) => setCat(e.target.value as typeof cat)} aria-label="Category">{MEMORY_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a memory or a rule…" aria-label="New memory" maxLength={200} />
        <button disabled={text.trim().length < 2 || !s.memoryEnabled}>Add</button>
      </form>
      {msg && <div className="small">{msg}</div>}
      <h4>Gesture preferences</h4>
      <ul className="mem-list">{Object.keys(memory.prefs).length ? Object.entries(memory.prefs).map(([k, v]) => <li key={k}><span>{k} → <b>{v}</b></span><span className="spacer" /><button className="link danger" onClick={() => void guard(() => memory.setPreference(k, null))}>clear</button></li>) : <li className="muted">None yet — say “use that gesture when greeting me”.</li>}</ul>
      <h4>Session summaries ({memory.summaries.length})</h4>
      <ul className="mem-list">{memory.summaries.map((x) => <li key={x.id}><span>{fmtDate(x.createdAt)} — {x.text}</span><span className="spacer" /><button className="link danger" onClick={() => void guard(() => memory.deleteSummary(x.id))}>delete</button></li>)}</ul>
      <div className="row wrap">
        <button onClick={() => download('nexus-memory.json', memory.exportJSON())}>Export</button>
        <button onClick={() => file.current?.click()}>Import…</button>
        <input ref={file} type="file" accept="application/json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const r = await memory.importJSON(await f.text()); setMsg(`Imported ${r.imported}; skipped ${r.skipped} (invalid, duplicate or sensitive).`); e.target.value = ''; }} />
        {!wipeAsk
          ? <button className="danger" onClick={() => setWipeAsk(true)}>Delete all…</button>
          : <span className="card warn confirm" role="alertdialog" aria-label="Confirm delete all memories">Delete ALL memories, preferences and summaries from this computer? This cannot be undone (copies an AI provider may keep are not affected).
              <span className="row"><button className="danger" onClick={() => { setWipeAsk(false); void guard(() => memory.wipeAll()); }}>Yes, delete all</button><button onClick={() => setWipeAsk(false)}>Keep them</button></span></span>}
      </div>
    </div>
  );
}
