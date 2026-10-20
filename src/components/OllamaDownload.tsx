/**
 * In-app download of a free offline model through Ollama (replaces the old setup-offline-ai script).
 * Shows Ollama's real progress, can be cancelled, and reports Ollama's own final result — never a guessed one.
 */
import { useRef, useState } from 'react';
import { api } from '../core/runtime';

export const SUGGESTED_MODELS = [
  { id: 'llama3.2', label: 'llama3.2 — about 2 GB, fastest (8 GB RAM)' },
  { id: 'qwen2.5:7b', label: 'qwen2.5:7b — about 4.7 GB, better answers (16 GB RAM)' },
  { id: 'llama3.1:8b', label: 'llama3.1:8b — about 4.9 GB, better answers (16 GB RAM)' },
];

const gb = (n: number) => `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB`;

export function OllamaDownload({ reachable, onDone }: { reachable: boolean; onDone: (model: string) => void }) {
  const [model, setModel] = useState(SUGGESTED_MODELS[0].id);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<{ status: string; completed?: number; total?: number } | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const ctl = useRef<AbortController | null>(null);

  if (!reachable) {
    return (
      <div className="ollama-get small" data-testid="ollama-install">
        <p>1. Install Ollama (free) from <a href="https://ollama.com/download" target="_blank" rel="noopener noreferrer">ollama.com/download</a> and start it.<br />
          2. Press “Check again” — then you can download a model right here.</p>
      </div>
    );
  }
  const start = async () => {
    setBusy(true); setResult(null); setProg({ status: 'starting' });
    ctl.current = new AbortController();
    try {
      const r = await api.pullModel(model, setProg, ctl.current.signal);
      setResult(r); if (r.ok) onDone(model.includes(':') ? model : `${model}:latest`);
    } catch (e) { setResult({ ok: false, message: (e as Error).message }); }
    finally { setBusy(false); ctl.current = null; }
  };
  const pct = prog?.total && prog.completed != null ? Math.min(100, Math.round((prog.completed / prog.total) * 100)) : null;
  return (
    <div className="ollama-get" data-testid="ollama-download">
      <div className="row wrap">
        <label className="sr-only" htmlFor="ollama-model">Model to download</label>
        <select id="ollama-model" value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}>
          {SUGGESTED_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        {busy
          ? <button type="button" onClick={() => ctl.current?.abort()}>Cancel download</button>
          : <button type="button" className="primary" onClick={() => void start()}>Download model</button>}
      </div>
      {busy && prog && (
        <div className="pull-progress" role="status" aria-live="polite">
          <div className="bar" aria-hidden><i style={{ width: `${pct ?? 0}%` }} className={pct == null ? 'indeterminate' : ''} /></div>
          <span className="small">{prog.status}{pct != null && prog.total ? ` — ${pct}% of ${gb(prog.total)}` : ''}</span>
        </div>
      )}
      {result && <div className={`small ${result.ok ? '' : 'err'}`} role="status">{result.ok ? '✓ ' : '✗ '}{result.message}</div>}
      <div className="muted small">Downloads once; afterwards it works offline. The first reply loads the model and can take up to a minute.</div>
    </div>
  );
}
