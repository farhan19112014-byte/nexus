/**
 * First-run setup (3 short steps, skippable, can be run again from Settings → Personalization):
 *   1. name your robot   2. choose its brain (demo / free Ollama on this computer / a hosted AI)   3. theme & voice
 * Everything is saved through the same paths as Settings (rename → companion, model → loopback-only /api/config).
 */
import { WEB_DEMO } from '../webDemo';
import { useEffect, useId, useRef, useState } from 'react';
import { OllamaDownload } from './OllamaDownload';
import { api, companion, memory } from '../core/runtime';
import { useSnapshot, useStore } from './hooks';
import { ROBOT_NAME_MAX, validateRobotName } from '../../shared/identity';
import type { Settings } from '../memory/store';

export const SETUP_EVENT = 'nexus:setup';
export const openSetup = () => window.dispatchEvent(new Event(SETUP_EVENT));

type Brain = 'demo' | 'ollama' | 'openai' | 'anthropic';
type Olla = { reachable: boolean; baseUrl: string; models: string[]; note: string } | null;

export function SetupWizard() {
  useStore(memory); const snap = useSnapshot();
  const s = memory.settings;
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(s.robotName);
  const [nameErr, setNameErr] = useState('');
  const [brain, setBrain] = useState<Brain>('demo');
  const [olla, setOlla] = useState<Olla>(null);
  const [model, setModel] = useState('');
  const [hosted, setHosted] = useState({ baseUrl: 'https://api.openai.com/v1', model: '', key: '' });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const ids = { title: useId(), desc: useId() };

  // open automatically the first time the workspace is used; reopen on request
  useEffect(() => { void memory.ready.then(() => { if (window.location.hash === '#setup') { window.history.replaceState(null, '', window.location.pathname); setStep(0); setOpen(true); } else if (!memory.settings.setupDone) setOpen(true); }); const o = () => { setStep(0); setOpen(true); }; window.addEventListener(SETUP_EVENT, o); return () => window.removeEventListener(SETUP_EVENT, o); }, []);
  useEffect(() => { if (s.setupDone && open && !ref.current?.dataset.manual) setOpen(false); }, [s.setupDone, open]);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) { setName(memory.settings.robotName); setResult(null); setNameErr(''); if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', ''); if (memory.settings.setupDone) d.dataset.manual = '1'; }
    if (!open && d.open) { d.close(); delete d.dataset.manual; }
  }, [open]);
  const checkOllama = () => api.localModels().then((r) => { setOlla(r.ollama); if (r.ollama.models.length && !model) setModel(r.ollama.models[0]); }).catch(() => setOlla({ reachable: false, baseUrl: '', models: [], note: 'The NEXUS server could not check for Ollama.' }));
  useEffect(() => { if (open && step === 1 && olla === null) void checkOllama(); }, [open, step]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Finishing or skipping both mark setup as done (it won't pop up again; Settings can reopen it). */
  const finish = async () => { await memory.updateSettings({ setupDone: true }).catch(() => {}); setOpen(false); };
  const next = async () => {
    if (step === 0) {
      const v = validateRobotName(name); if (!v.ok) { setNameErr(v.error); return; }
      const r = await companion.renameRobot(v.name); if (!r.ok) { setNameErr(r.error); return; }
      setStep(1); return;
    }
    if (step === 1) {
      setResult(null);
      if (brain === 'demo') { setStep(2); return; }
      if (!snap.caps?.runtimeConfig) { setResult({ ok: false, text: 'This server does not allow changing the model from the app — edit .env instead (see docs/SETUP.md).' }); return; }
      const body = brain === 'ollama'
        ? { provider: 'openai', openai: { baseUrl: olla?.baseUrl || 'http://127.0.0.1:11434/v1', model } }
        : brain === 'openai'
          ? { provider: 'openai', openai: { baseUrl: hosted.baseUrl, model: hosted.model, ...(hosted.key ? { apiKey: hosted.key } : {}) } }
          : { provider: 'anthropic', anthropic: { model: hosted.model, ...(hosted.key ? { apiKey: hosted.key } : {}) } };
      if ((brain === 'ollama' && !model) || (brain !== 'ollama' && !hosted.model.trim())) { setResult({ ok: false, text: 'Please choose or type a model name first.' }); return; }
      setBusy(true);
      try {
        await api.putConfig(body); await companion.refreshStatus();
        const t = await api.testConnection().catch((e) => ({ ok: false, message: (e as Error).message }));
        companion.recordConnection(t.ok ? 'ok' : 'failed', t.message);
        setResult({ ok: t.ok, text: t.ok ? `Connected — ${t.message}` : `Saved, but the test failed: ${t.message}` });
        setHosted((h) => ({ ...h, key: '' }));
        if (t.ok) setStep(2);
      } catch (e) { setResult({ ok: false, text: (e as Error).message }); }
      finally { setBusy(false); }
      return;
    }
    await finish();
  };
  const up = (p: Partial<Settings>) => void memory.updateSettings(p).then(() => companion.applySettings()).catch(() => {});
  const steps = ['Name', 'Brain', 'Style'];

  return (
    <dialog ref={ref} className="modal setup" aria-labelledby={ids.title} aria-describedby={ids.desc} onCancel={(e) => { e.preventDefault(); void finish(); }}>
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); void next(); }}>
        <ol className="setup-steps" aria-label="Setup progress">{steps.map((l, i) => <li key={l} className={i === step ? 'on' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>{l}</li>)}</ol>
        {step === 0 && <>
          <h2 id={ids.title}>Hi! Let’s set up your robot</h2>
          <p id={ids.desc} className="muted">Three quick steps. You can change everything later in Settings.</p>
          <label className="field" htmlFor="setup-name">What should your robot be called?
            <input id="setup-name" value={name} maxLength={ROBOT_NAME_MAX * 4} autoComplete="off" onChange={(e) => { setName(e.target.value); setNameErr(''); }} aria-invalid={!!nameErr} aria-describedby={nameErr ? 'setup-name-err' : undefined} autoFocus />
          </label>
          {nameErr && <p id="setup-name-err" className="err small" role="alert">{nameErr}</p>}
        </>}
        {step === 1 && <>
          <h2 id={ids.title}>Choose {memory.settings.robotName}’s brain</h2>
          <p id={ids.desc} className="muted">This decides who writes the replies. The robot’s face and movements work with all of them.</p>
          <fieldset className="brain-options">
            <legend className="sr-only">Brain</legend>
            {WEB_DEMO && <p className="small warn-t" data-testid="web-demo-setup">Web demo: only the demo brain is available here (there is no NEXUS server). Run NEXUS on your computer for a real AI.</p>}
            <label className={`brain ${brain === 'demo' ? 'on' : ''}`}><input type="radio" name="brain" checked={brain === 'demo'} onChange={() => setBrain('demo')} /><span><b>Demo brain</b> — works right now, offline. Scripted, <em>not an AI</em>: it understands movement commands, not questions.</span></label>
            <label className={`brain ${brain === 'ollama' ? 'on' : ''}`}><input type="radio" name="brain" checked={brain === 'ollama'} disabled={WEB_DEMO} onChange={() => setBrain('ollama')} /><span><b>Free AI on this computer (Ollama)</b> — a real open model; no account or key; replies stay on your computer.</span></label>
            {brain === 'ollama' && <div className="brain-detail">
              <div className="small" role="status">{olla ? `${olla.reachable ? '✓' : '✗'} ${olla.note}` : 'Checking for Ollama…'}</div>
              {olla?.reachable && olla.models.length > 0 && <label className="field">Model<select value={model} onChange={(e) => setModel(e.target.value)}>{olla.models.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>}
              {olla && <OllamaDownload reachable={olla.reachable} onDone={(m) => { setModel(m); void checkOllama(); }} />}
              <button type="button" className="link" onClick={() => { setOlla(null); void checkOllama(); }}>Check again</button>
            </div>}
            <label className={`brain ${brain === 'openai' ? 'on' : ''}`}><input type="radio" name="brain" checked={brain === 'openai'} disabled={WEB_DEMO} onChange={() => setBrain('openai')} /><span><b>Hosted AI (OpenAI-compatible)</b> — OpenAI, OpenRouter, Groq, LM Studio… Needs an API key; may cost money per message.</span></label>
            <label className={`brain ${brain === 'anthropic' ? 'on' : ''}`}><input type="radio" name="brain" checked={brain === 'anthropic'} disabled={WEB_DEMO} onChange={() => setBrain('anthropic')} /><span><b>Anthropic (Claude)</b> — needs an API key; may cost money per message.</span></label>
            {(brain === 'openai' || brain === 'anthropic') && <div className="brain-detail">
              {brain === 'openai' && <label className="field">Base URL<input value={hosted.baseUrl} onChange={(e) => setHosted({ ...hosted, baseUrl: e.target.value })} /></label>}
              <label className="field">Model<input value={hosted.model} onChange={(e) => setHosted({ ...hosted, model: e.target.value })} placeholder="a current model id from your provider" /></label>
              <label className="field">API key<input type="password" autoComplete="off" value={hosted.key} onChange={(e) => setHosted({ ...hosted, key: e.target.value })} placeholder="kept on the NEXUS server, never shown again" /></label>
            </div>}
          </fieldset>
          {result && <p className={`small ${result.ok ? '' : 'err'}`} role="status">{result.text}</p>}
        </>}
        {step === 2 && <>
          <h2 id={ids.title}>Make it yours</h2>
          <p id={ids.desc} className="muted">Small choices — all of them live in Settings too.</p>
          <label className="field">Theme<select value={s.theme} onChange={(e) => up({ theme: e.target.value as Settings['theme'] })}><option value="dark">Dark</option><option value="light">Light</option><option value="system">Match my computer</option></select></label>
          <label className="toggle"><input type="checkbox" checked={s.voiceOutput} disabled={!companion.tts.supported} onChange={(e) => up({ voiceOutput: e.target.checked })} /> Read replies aloud{companion.tts.supported ? '' : ' (not supported here)'}</label>
          <label className="toggle"><input type="checkbox" checked={s.reducedMotion} onChange={(e) => up({ reducedMotion: e.target.checked })} /> Reduced motion</label>
          <label className="toggle"><input type="checkbox" checked={s.dailyGreeting} onChange={(e) => up({ dailyGreeting: e.target.checked })} /> A short hello once a day</label>
          <p className="small muted">Try: “wave then nod”, “remind me in 10 minutes to stretch”, or “invent a new greeting”.</p>
        </>}
        <div className="row modal-actions">
          <button type="button" className="link" onClick={() => void finish()}>Skip setup</button>
          <span className="spacer" />
          {step > 0 && <button type="button" onClick={() => { setResult(null); setStep(step - 1); }} disabled={busy}>Back</button>}
          {step === 1 && result && !result.ok && brain !== 'demo' && <button type="button" onClick={() => setStep(2)}>Continue anyway</button>}
          <button type="submit" className="primary" disabled={busy}>{busy ? 'Connecting…' : step === 2 ? 'Start chatting' : step === 1 && brain !== 'demo' ? 'Save & test' : 'Next'}</button>
        </div>
      </form>
    </dialog>
  );
}
