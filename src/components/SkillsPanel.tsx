/** Assets 39, 61, 67–70 — skill library, preview with validation details, approval, versions/rollback, feedback, lab, import/export. */
import { Icon } from './Icon';
import { useEffect, useRef, useState } from 'react';
import { Robot, type RigHandle } from '../character/Robot';
import { companion, learning, memory, registry } from '../core/runtime';
import { download, fmtDate, useSnapshot, useStore } from './hooks';
import { USABLE, type SkillRecord, type FailureLog } from '../skills/registry';
import { SkillProposalSchema, type SkillDef } from '../../shared/schema';
import { compileGeneratorSpec } from '../skills/generator';
import { validateExpression, validateWithRepair, type ValidationReport } from '../skills/validator';
import { SkillDefSchema } from '../../shared/schema';

const SAMPLE = JSON.stringify({ format: 'generator', spec: { id: 'hello_hop', name: 'Hello hop', description: 'A wave and a little hop', motifs: [{ motif: 'wave', repeats: 2 }, { motif: 'hop', intensity: 0.8 }] } }, null, 2);

function Report({ r }: { r: Pick<ValidationReport, 'ok' | 'risk' | 'errors' | 'warnings' | 'fixes' | 'metrics'> }) {
  return (
    <div className="report">
      <b>{r.ok ? '✓ passed validation' : '✗ rejected'}</b> · risk {r.risk} · {r.metrics.samples} simulation samples · {r.metrics.duration.toFixed(1)}s · peak speed {(r.metrics.peakSpeedRatio * 100).toFixed(0)}% of limit{r.metrics.worstChannel ? ` (${r.metrics.worstChannel})` : ''}
      {r.fixes.map((f, i) => <div key={i}>fix: {f}</div>)}
      {r.errors.map((e, i) => <div key={i} className="err">✗ {e.message}</div>)}
      {r.warnings.map((e, i) => <div key={i} className="warn-t">! {e.message}</div>)}
    </div>
  );
}

/** Asset 67 — preview interface backed by the sandbox (Asset 66). */
export function PreviewStage() {
  const snap = useSnapshot(); useStore(registry);
  const rig = useRef<RigHandle>(null);
  useEffect(() => { companion.sandbox.attach(rig.current); return () => companion.sandbox.attach(null); }, [snap.preview?.id]);
  const p = snap.preview; if (!p) return null;
  const v = registry.getVersion(p.id, p.version);
  const def = v?.def as (SkillDef & { face?: Record<string, number> }) | undefined;
  return (
    <div className="card preview" role="dialog" aria-label={`Preview of ${p.name}`}>
      <div className="row"><b>Sandbox preview: {p.name}</b> <span className={`badge b-${v?.status}`}>{statusLabel(v?.status, v?.report?.ok)}</span><span className="spacer" /><button onClick={() => companion.closePreview()} aria-label="Close preview"><Icon name="close" /></button></div>
      <div className="preview-body">
        <div className="preview-robot"><Robot ref={rig} environment="grid" effects={false} title={`Preview of ${p.name}`} /></div>
        <div className="preview-info">
          <div className="muted">Runs on an isolated copy of the character — no access to network, storage or secrets.</div>
          {def && v?.kind !== 'expression' && <div>Duration {def.duration}s · {def.tracks.length} tracks · speed ×{def.params.speed.default} · size ×{def.params.amplitude.default}</div>}
          {def && v?.kind !== 'expression' && <div className="muted">Channels: {def.tracks.map((t) => t.channel).join(', ')}</div>}
          {v?.kind === 'expression' && <div className="muted">Face parameters: {Object.entries(def!.face ?? {}).map(([k, x]) => `${k}=${(x as number).toFixed(2)}`).join(', ')}</div>}
          {v?.report && <Report r={v.report} />}
          <div className="row">
            <button onClick={() => companion.previewSkill(p.id, p.version)}><Icon name="retry" /> Replay</button>
            {v?.status === 'proposed' && <><button className="primary" onClick={() => void companion.approve(p.id, p.version)}>Approve</button><button className="danger" onClick={() => void companion.reject(p.id, p.version)}>Reject</button></>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Lifecycle wording shown to the user (spec §11.4); the stored status values stay unchanged. */
export function statusLabel(status: string | undefined, passed?: boolean): string {
  switch (status) {
    case 'proposed': return passed === false ? 'failed validation' : 'awaiting approval';
    case 'failed': return 'failed validation';
    case 'deprecated': return 'unavailable';
    case 'builtin': return 'built-in';
    default: return status ?? 'unknown';
  }
}

function Row({ r }: { r: SkillRecord }) {
  const [open, setOpen] = useState(false); const [msg, setMsg] = useState(''); const [confirmDel, setConfirmDel] = useState(false);
  const act = r.versions.find((v) => v.version === r.activeVersion);
  const usable = r.kind === 'expression' ? !!registry.getExpression(r.id) : !!registry.get(r.id);
  const pending = r.versions.filter((v) => v.status === 'proposed');
  const name = (act?.def as { name?: string })?.name ?? r.id;
  const play = async () => { const res = await companion.playSkill(r.id); setMsg(res === 'unavailable' ? 'Unavailable — not approved or deprecated.' : ''); };
  const guard = async (f: () => Promise<unknown>) => { try { await f(); setMsg(''); } catch (e) { setMsg((e as Error).message); } };
  return (
    <li className="skill">
      <div className="row">
        <button className="link name" onClick={() => setOpen(!open)} aria-expanded={open} title={name}>{name}</button>
        <span className={`badge b-${act?.status}`}>{statusLabel(act?.status, act?.report?.ok)}</span><span className="muted meta">{r.kind} · v{r.activeVersion}</span><span className="spacer" />
        <button onClick={() => void play()} aria-label={`Play ${name}`} title={usable ? `Play on ${memory.settings.robotName}` : 'Unavailable until approved'}><Icon name="play" /></button>
        <button onClick={() => companion.previewSkill(r.id)} aria-label={`Preview ${name}`}><Icon name="eye" /></button>
      </div>
      {msg && <div className="err small">{msg}</div>}
      {pending.map((v) => (
        <div key={v.version} className="pending row wrap">
          <span>v{v.version} proposed — {v.note}</span>
          <button onClick={() => companion.previewSkill(r.id, v.version)}>Preview</button>
          <button className="primary" onClick={() => void companion.approve(r.id, v.version)}>Approve</button>
          <button className="danger" onClick={() => void companion.reject(r.id, v.version)}>Reject</button>
        </div>
      ))}
      {open && act && (
        <div className="skill-body">
          <p>{(act.def as { description?: string }).description}</p>
          <div className="muted">by {act.createdBy} · runs {r.stats.runs} ({r.stats.completed} completed) · <Icon name="thumbUp" /> {act.votes.up} <Icon name="thumbDown" /> {act.votes.down} · rig {act.compatibility.rig}</div>
          {act.report && <Report r={act.report} />}
          <div className="versions"><b>Versions</b>{r.versions.map((v) => (
            <div key={v.version} className={v.version === r.activeVersion ? 'cur' : ''}>v{v.version} <span className={`badge b-${v.status}`}>{statusLabel(v.status, v.report?.ok)}</span> <span className="muted">{v.createdBy} · {fmtDate(v.createdAt)} · {v.note}</span>
              {v.version !== r.activeVersion && USABLE.includes(v.status) && <button className="link" onClick={() => void guard(() => registry.activate(r.id, v.version))}>activate</button>}
              {v.status === 'deprecated' && <button className="link" onClick={() => void guard(() => registry.restore(r.id, v.version))}>restore</button>}
            </div>))}
          </div>
          <div className="row wrap">
            <button onClick={() => void learning.rate(r.id, true, 'manual rating')} disabled={!usable} aria-label="Rate up"><Icon name="thumbUp" /></button>
            <button onClick={() => void learning.rate(r.id, false, 'manual rating')} disabled={!usable} aria-label="Rate down"><Icon name="thumbDown" /></button>
            {r.kind === 'motion' && <><button onClick={() => void guard(() => learning.refine({ skillId: r.id, speedFactor: 0.8, note: 'manual: slower' }, null).then((o) => setMsg(o.message)))} disabled={!usable}>Slower</button>
              <button onClick={() => void guard(() => learning.refine({ skillId: r.id, amplitudeFactor: 0.75, note: 'manual: subtler' }, null).then((o) => setMsg(o.message)))} disabled={!usable}>Subtler</button></>}
            <button onClick={() => void guard(async () => { const v = await registry.revert(r.id); setMsg(v ? `Reverted to v${v}.` : 'No earlier approved version.'); })}>Revert</button>
            {!r.builtin && act.status === 'approved' && <button onClick={() => void guard(() => registry.deprecate(r.id))}>Deprecate</button>}
            {!confirmDel
              ? <button className="danger" disabled={r.builtin && r.versions.length === 1} onClick={() => setConfirmDel(true)}>{r.builtin ? 'Reset to built-in' : 'Delete'}</button>
              : <span className="card warn confirm" role="alertdialog" aria-label={r.builtin ? `Confirm reset of ${name}` : `Confirm delete of ${name}`}>
                  {r.builtin ? `Reset “${name}” to its built-in version? Your versions of it are removed.` : `Delete “${name}” and all its versions? Other skills are not affected.`}
                  <span className="row"><button className="danger" onClick={() => { setConfirmDel(false); void guard(() => registry.remove(r.id)); }}>{r.builtin ? 'Yes, reset' : 'Yes, delete'}</button><button onClick={() => setConfirmDel(false)}>Keep it</button></span>
                </span>}
          </div>
        </div>
      )}
    </li>
  );
}

function Lab() {
  const [src, setSrc] = useState(SAMPLE); const [rep, setRep] = useState<ValidationReport | null>(null); const [msg, setMsg] = useState('');
  const check = () => {
    setMsg('');
    try {
      const p = SkillProposalSchema.parse(JSON.parse(src));
      if (p.format === 'expression') setRep(validateExpression(p.expression, { lookup: (x) => registry.get(x) }).report);
      else setRep(validateWithRepair(p.format === 'generator' ? compileGeneratorSpec(p.spec) : SkillDefSchema.parse(p.skill), { lookup: (x) => registry.get(x) }).report);
    } catch (e) { setRep(null); setMsg(`Invalid proposal: ${(e as Error).message.slice(0, 300)}`); }
  };
  return (
    <details className="lab">
      <summary>Skill Lab — write a proposal by hand (same pipeline the AI uses)</summary>
      <textarea value={src} onChange={(e) => setSrc(e.target.value)} rows={9} spellCheck={false} aria-label="Skill proposal JSON" />
      <div className="row"><button onClick={check}>Validate &amp; simulate</button><button className="primary" onClick={async () => { try { const o = await learning.propose(JSON.parse(src)); setMsg(o.message); } catch (e) { setMsg((e as Error).message); } }}>Submit as proposal</button></div>
      {msg && <div className="small">{msg}</div>}
      {rep && <Report r={rep} />}
    </details>
  );
}

export default function SkillsPanel() {
  useStore(registry); useStore(memory);
  const [kind, setKind] = useState<'all' | 'motion' | 'expression' | 'proposed'>('all');
  const [fails, setFails] = useState<FailureLog[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const registryVersion = registry.version;
  useEffect(() => { void registry.failures().then(setFails); }, [registryVersion]);
  const list = registry.list().filter((r) => kind === 'all' || (kind === 'proposed' ? r.versions.some((v) => v.status === 'proposed') : r.kind === kind || (kind === 'motion' && r.kind === 'composite')));
  return (
    <div className="skills">
      <PreviewStage />
      <p className="muted small">New motions and expressions are proposals until you approve them. Approving changes the app's skill registry — it does not retrain the AI model.</p>
      <div className="row wrap">
        <div className="seg" role="group" aria-label="Filter">{(['all', 'motion', 'expression', 'proposed'] as const).map((k) => <button key={k} aria-pressed={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k}{k === 'proposed' ? ` (${registry.pending().length})` : ''}</button>)}</div>
        <span className="spacer" />
        <button onClick={() => void companion.send('Invent a new greeting')}><Icon name="spark" /> Invent motion</button>
        <button onClick={() => void companion.send('Invent a new expression')}><Icon name="spark" /> Invent expression</button>
      </div>
      <label className="toggle small"><input type="checkbox" checked={memory.settings.refinementPolicy === 'auto_low_risk'} onChange={(e) => void memory.updateSettings({ refinementPolicy: e.target.checked ? 'auto_low_risk' : 'require' })} /> Apply low-risk refinements (speed/size tweaks) without asking — new skills always need approval</label>
      {registry.lastError && <div className="card error">{registry.lastError}</div>}
      <ul className="skill-list">{list.map((r) => <Row key={r.id} r={r} />)}</ul>
      <Lab />
      <div className="row wrap">
        <button onClick={() => download('nexus-skills.json', registry.exportJSON())}>Export learned skills</button>
        <button onClick={() => file.current?.click()}>Import…</button>
        <input ref={file} type="file" accept="application/json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const r = await registry.importJSON(await f.text()); companion.notifications.push('info', `Imported ${r.imported} version(s) as proposals; ${r.rejected} rejected by validation.`, { react: false }); e.target.value = ''; }} />
      </div>
      {registry.quarantined.length > 0 && <div className="card warn">Quarantined on load: {registry.quarantined.map((q) => `${q.id} (${q.reason})`).join('; ')}</div>}
      <details><summary>Failure log ({fails.length})</summary>
        {fails.length ? <><ul className="small">{fails.slice(0, 30).map((f) => <li key={f.id}><b>{f.skillId}</b> <span className="muted">{fmtDate(f.at)} · {f.source}</span> — {f.errors.join('; ')}</li>)}</ul><button onClick={() => void registry.clearFailures()}>Clear</button></> : <p className="muted">No failed attempts.</p>}
      </details>
    </div>
  );
}
