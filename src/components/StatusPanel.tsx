/** Assets 49, 78, 80, 95, 99, 10/100 — capabilities, tool permissions, learning disclosure, diagnostics, performance, asset registry. */
import { useCallback, useEffect, useState } from 'react';
import { companion, engine, memory, registry, runtime } from '../core/runtime';
import { download, fmtTime, usePoll, useSnapshot, useStore } from './hooks';
import { TOOLS } from '../security/toolPermissions';
import { ASSETS } from '../assets/registry';

interface AssetStatus { generatedAt: string; assets: Record<string, { status: string; passed: number; failed: number; missing: string[] }> }

export default function StatusPanel() {
  const snap = useSnapshot(); useStore(companion.diagnostics);
  const perf = usePoll(useCallback(() => runtime.stats(), []), 1000);
  const [status, setStatus] = useState<AssetStatus | null>(null);
  const [filter, setFilter] = useState('');
  useEffect(() => { fetch('/asset-status.json').then((r) => (r.ok ? r.json() : null)).then(setStatus).catch(() => setStatus(null)); }, []);
  const counts = companion.diagnostics.counts();
  useStore(registry); useStore(memory);
  const live = usePoll(useCallback(() => ({ acts: engine.active().filter((a) => a.phase !== 'out' && !a.preview).map((a) => a.name), preview: engine.active().find((a) => a.preview)?.name ?? null }), []), 300);
  const recs = registry.list();
  const reg = { builtin: recs.filter((r) => r.builtin).length, approved: recs.filter((r) => !r.builtin && r.versions.some((v) => v.status === 'approved')).length, proposed: recs.filter((r) => r.versions.some((v) => v.status === 'proposed')).length };
  return (
    <div className="status">
      <h4>Right now</h4>
      <table className="now small"><tbody>
        <tr><th>App state</th><td>{snap.state}{snap.busy ? ' (request in progress)' : ''}</td></tr>
        <tr><th>AI mode</th><td>{snap.caps?.isLLM ? `Real model — ${snap.caps.label}` : snap.caps?.provider === 'local-demo' ? 'Server unreachable' : 'Demo brain (scripted, not an LLM)'}</td></tr>
        <tr><th>Model</th><td>{snap.caps?.model ?? '—'}</td></tr>
        <tr><th>Last AI check</th><td data-testid="last-check">{snap.connection.state === 'untested' ? 'not checked yet — send a message or use Settings → Model → Test connection' : `${snap.connection.state === 'ok' ? '✓ worked' : snap.connection.state === 'demo' ? 'demo brain answered' : '✗ failed'} · ${snap.connection.detail}${snap.connection.at ? ` · ${new Date(snap.connection.at).toLocaleTimeString()}` : ''}`}</td></tr>
        <tr><th>Active animation</th><td>{live.acts.length ? live.acts.join(', ') : 'none'}{live.preview ? ` · preview: ${live.preview}` : ''}</td></tr>
        <tr><th>Skill registry</th><td>{reg.approved} approved · {reg.proposed} awaiting approval · {reg.builtin} built-in{registry.quarantined.length ? ` · ${registry.quarantined.length} quarantined` : ''}</td></tr>
        <tr><th>Memory</th><td>{memory.settings.memoryEnabled ? `${memory.active().length} saved` : 'off'} · {companion.getSnapshot().capabilities.find((c) => c.id === 'memory')?.detail ?? ''}</td></tr>
      </tbody></table>
      <h4>Capabilities</h4>
      <ul className="caps">{snap.capabilities.map((c) => <li key={c.id}><span className={`badge cap-${c.state}`}>{c.state.replace('_', ' ')}</span> <b>{c.name}</b><div className="muted small">{c.detail}</div></li>)}</ul>
      <h4>Learning & training disclosure</h4>
      <p className="small">NEXUS can change: <b>the conversation</b> (this tab), <b>memory</b> (only with your consent), <b>preferences</b>, <b>the skill registry</b> (only approved skills), and it can <b>retrieve</b> sources for a message. It cannot change <b>the language model</b>: no training or fine-tuning happens in this app. Each reply's “What changed?” lists exactly which of these it touched.</p>
      <h4>Tool permissions</h4>
      <table className="tools"><thead><tr><th>Tool</th><th>Permissions</th><th>Consent</th><th>Failure modes</th></tr></thead>
        <tbody>{TOOLS.map((t) => <tr key={t.id}><td><b>{t.name}</b><div className="muted small">{t.description}</div></td><td>{t.permissions.join(', ')}</td><td>{t.userConsent}</td><td className="small">{t.failureModes.join('; ')}</td></tr>)}</tbody></table>
      <h4>Performance</h4>
      <p className="small">Frame work: avg {perf.avgFrameMs.toFixed(2)} ms · max {perf.maxFrameMs.toFixed(2)} ms · {perf.frames} frames rendered. One animation loop; paused while the tab is hidden.</p>
      <h4>Diagnostics <span className="muted small">(codes and timings only{companion.diagnostics.includeContent ? '; redacted content ON' : ''})</span></h4>
      <div className="row wrap"><button onClick={() => download('nexus-diagnostics.json', companion.diagnostics.export())}>Export</button><button onClick={() => companion.diagnostics.clear()}>Clear</button><span className="muted small">{Object.entries(counts).slice(0, 8).map(([k, v]) => `${k}×${v}`).join(' · ')}</span></div>
      <ol className="diag small">{companion.diagnostics.events.slice(-25).reverse().map((e, i) => <li key={i}><time>{fmtTime(e.at)}</time> <b>{e.type}</b> {e.code}{e.ms !== undefined ? ` ${e.ms}ms` : ''}{e.detail ? ` — ${e.detail}` : ''}</li>)}</ol>
      <h4>Asset registry ({ASSETS.length})</h4>
      <p className="muted small">{status ? `Verification from the last test run (${new Date(status.generatedAt).toLocaleString()}).` : 'No verification report found (run npm run report). Showing declared implementation status only.'}</p>
      <input placeholder="Filter assets…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter assets" />
      <table className="assets"><thead><tr><th>ID</th><th>Asset</th><th>Status</th></tr></thead>
        <tbody>{ASSETS.filter((a) => !filter || `${a.id} ${a.name} ${a.category}`.toLowerCase().includes(filter.toLowerCase())).map((a) => {
          const v = status?.assets[a.id];
          const st = v?.status ?? a.implementation;
          return <tr key={a.id}><td>{a.id}</td><td><b>{a.name}</b><div className="muted small">{a.paths.join(', ')}{a.limitations ? ` — ${a.limitations}` : ''}</div></td><td><span className={`badge as-${st}`}>{st}</span>{v ? <div className="muted small">{v.passed} passed{v.failed ? `, ${v.failed} failed` : ''}</div> : null}</td></tr>;
        })}</tbody></table>
    </div>
  );
}
