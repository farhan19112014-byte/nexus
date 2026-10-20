/** Assets 50, 57, 87, 88, 89 — settings that change real behaviour, plus the secure model configuration panel. */
import { openRenameDialog } from './RenameDialog';
import { openSetup } from './SetupWizard';
import { OllamaDownload } from './OllamaDownload';
import { chats } from '../core/runtime';
import { useEffect, useState } from 'react';
import { api, companion, memory } from '../core/runtime';
import { useSnapshot, useStore } from './hooks';
import type { Settings } from '../memory/store';

interface PublicCfg { provider: string; allowRuntimeConfig: boolean; openai: { baseUrl: string; model: string; jsonMode: boolean; apiKey: { set: boolean; hint: string | null } }; anthropic: { model: string; apiKey: { set: boolean; hint: string | null } }; research: { provider: string; searxngUrl: string; tavilyKey: { set: boolean; hint: string | null } } }

function ModelPanel() {
  const snap = useSnapshot();
  const [cfg, setCfg] = useState<PublicCfg | null>(null); const [err, setErr] = useState('');
  const [form, setForm] = useState({ provider: 'demo', baseUrl: '', model: '', key: '', aModel: '', aKey: '', research: 'none', searx: '', tavily: '' });
  const [test, setTest] = useState<string>('');
  const [olla, setOlla] = useState<{ reachable: boolean; baseUrl: string; models: string[]; note: string } | null>(null);
  const checkOllama = () => api.localModels().then((r) => setOlla(r.ollama)).catch(() => setOlla(null));
  useEffect(() => { void checkOllama(); }, []);
  const load = () => api.getConfig().then((c: PublicCfg) => { setCfg(c); setForm((f) => ({ ...f, provider: c.provider, baseUrl: c.openai.baseUrl, model: c.openai.model, aModel: c.anthropic.model, research: c.research.provider, searx: c.research.searxngUrl, key: '', aKey: '', tavily: '' })); }).catch(() => setErr('The API server is not reachable, so the model cannot be configured from here.'));
  useEffect(() => { void load(); }, []);
  const save = async () => {
    setErr(''); setTest('');
    try {
      const body: Record<string, unknown> = { provider: form.provider, openai: { baseUrl: form.baseUrl || undefined, model: form.model || undefined, ...(form.key ? { apiKey: form.key } : {}) }, anthropic: { model: form.aModel || undefined, ...(form.aKey ? { apiKey: form.aKey } : {}) }, research: { provider: form.research, searxngUrl: form.searx || undefined, ...(form.tavily ? { tavilyKey: form.tavily } : {}) } };
      await api.putConfig(body); await load(); await companion.refreshStatus(); setTest('Saved. Secrets are stored only on the server and are never shown again.');
    } catch (e) { setErr((e as Error).message); }
  };
  if (err && !cfg) return <div className="card warn">{err}</div>;
  if (!cfg) return <p className="muted">Loading model configuration…</p>;
  const F = (k: keyof typeof form) => ({ value: form[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value }) });
  return (
    <div className="card model">
      <div className="small">Active: <b>{snap.caps?.label}</b> {snap.caps?.isLLM ? (snap.caps.configured ? '✓ configured' : '— not configured') : '(not an LLM)'} · prompt {snap.caps?.promptVersion}</div>
      {!cfg.allowRuntimeConfig && <div className="muted small">Runtime configuration is disabled on the server; edit .env instead.</div>}
      <div className="card ollama">
        <div><b>Free offline AI (Ollama)</b> — runs a real open model on this computer; no account, no key, no per-use cost.</div>
        <div className="small" role="status">{olla ? (olla.reachable ? '✓ ' : '✗ ') + olla.note : 'Checking for Ollama…'}</div>
        <div className="row wrap">
          {olla?.reachable && olla.models.length > 0 && olla.models.slice(0, 4).map((m) => (
            <button key={m} disabled={!cfg.allowRuntimeConfig} onClick={() => setForm({ ...form, provider: 'openai', baseUrl: olla.baseUrl, model: m, key: '' })}>Use {m}</button>
          ))}
          <button className="link" onClick={() => void checkOllama()}>Check again</button>
        </div>
        {olla?.reachable && olla.models.length > 0 && <div className="muted small">Pick a model, then press Save and Test connection.</div>}
        <OllamaDownload reachable={!!olla?.reachable} onDone={(m) => { void checkOllama(); if (olla) setForm((f) => ({ ...f, provider: 'openai', baseUrl: olla.baseUrl, model: m, key: '' })); }} />
      </div>
      <label className="field">Provider<select {...F('provider')} disabled={!cfg.allowRuntimeConfig}><option value="demo">Demo brain (no credentials, not an LLM)</option><option value="openai">OpenAI-compatible (OpenAI, Ollama, OpenRouter, Groq…)</option><option value="anthropic">Anthropic</option></select></label>
      {form.provider === 'openai' && <>
        <label className="field">Base URL<input {...F('baseUrl')} placeholder="https://api.openai.com/v1 or http://localhost:11434/v1" /></label>
        <label className="field">Model<input {...F('model')} placeholder="model id, e.g. llama3.1:8b for Ollama" /></label>
        <label className="field">API key {cfg.openai.apiKey.set ? <span className="muted">(set {cfg.openai.apiKey.hint} — leave blank to keep)</span> : <span className="muted">(not set; not needed for local servers)</span>}<input type="password" autoComplete="off" {...F('key')} /></label>
      </>}
      {form.provider === 'anthropic' && <>
        <label className="field">Model<input {...F('aModel')} placeholder="a current model id from Anthropic's docs" /></label>
        <label className="field">API key {cfg.anthropic.apiKey.set ? <span className="muted">(set {cfg.anthropic.apiKey.hint} — leave blank to keep)</span> : <span className="muted">(not set)</span>}<input type="password" autoComplete="off" {...F('aKey')} /></label>
      </>}
      <label className="field">Research provider<select {...F('research')}><option value="none">None (no live research)</option><option value="wikipedia">Wikipedia (free, no key)</option><option value="searxng">SearXNG (self-hosted)</option><option value="tavily">Tavily (API key; may be paid)</option></select></label>
      {form.research === 'searxng' && <label className="field">SearXNG URL<input {...F('searx')} placeholder="http://localhost:8080" /></label>}
      {form.research === 'tavily' && <label className="field">Tavily key {cfg.research.tavilyKey.set ? <span className="muted">(set {cfg.research.tavilyKey.hint})</span> : ''}<input type="password" autoComplete="off" {...F('tavily')} /></label>}
      <div className="row"><button className="primary" onClick={() => void save()} disabled={!cfg.allowRuntimeConfig}>Save</button><button onClick={async () => { setTest('Testing…'); const r = await api.testConnection().catch((e) => ({ ok: false, message: (e as Error).message })); companion.recordConnection(r.ok ? (snap.caps?.isLLM ? 'ok' : 'demo') : 'failed', r.message); setTest(`${r.ok ? '✓' : '✗'} ${r.message}`); }}>Test connection</button></div>
      {test && <div className="small" role="status">{test}</div>}
      {err && <div className="err small">{err}</div>}
      <p className="muted small">Changes are accepted only from this computer. Hosted providers may charge per use — check their pricing.</p>
    </div>
  );
}

interface SpeechPub { tts: { provider: string; baseUrl: string; model: string; voice: string; apiKey: { set: boolean; hint: string | null }; configured: boolean; note: string }; stt: { provider: string; baseUrl: string; model: string; language: string; apiKey: { set: boolean; hint: string | null }; configured: boolean; note: string } }

/** Optional server speech services (spec §11–§13). Keys are write-only and stay on the NEXUS server. */
function SpeechServicePanel() {
  const snap = useSnapshot();
  const [pub, setPub] = useState<SpeechPub | null>(null); const [allowed, setAllowed] = useState(false);
  const [f, setF] = useState({ ttsProvider: 'none', ttsBaseUrl: '', ttsModel: '', ttsVoice: '', ttsApiKey: '', sttProvider: 'none', sttBaseUrl: '', sttModel: '', sttApiKey: '', sttLanguage: '' });
  const [msg, setMsg] = useState('');
  const load = () => api.getConfig().then((c: { allowRuntimeConfig: boolean; speech?: SpeechPub }) => {
    setAllowed(c.allowRuntimeConfig); if (!c.speech) return; setPub(c.speech);
    setF((x) => ({ ...x, ttsProvider: c.speech!.tts.provider, ttsBaseUrl: c.speech!.tts.baseUrl, ttsModel: c.speech!.tts.model, ttsVoice: c.speech!.tts.voice, sttProvider: c.speech!.stt.provider, sttBaseUrl: c.speech!.stt.baseUrl, sttModel: c.speech!.stt.model, sttLanguage: c.speech!.stt.language, ttsApiKey: '', sttApiKey: '' }));
  }).catch(() => setPub(null));
  useEffect(() => { void load(); }, []);
  if (!pub) return <p className="muted small">Server speech settings are unavailable (the NEXUS server did not answer).</p>;
  const F = (k: keyof typeof f) => ({ value: f[k], disabled: !allowed, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value }) });
  const save = async () => {
    setMsg('');
    const clean = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''));
    try { await api.putConfig({ speech: clean }); await load(); await companion.refreshStatus(); setMsg('Saved. Keys are kept on the NEXUS server and never shown again.'); } catch (e) { setMsg(`✗ ${(e as Error).message}`); }
  };
  const test = () => { setMsg(companion.readAloud(`Hello, I am ${memory.settings.robotName}. This is how my voice sounds.`) ? `Speaking with the ${companion.voiceOut?.engineName ?? 'browser'} voice…` : 'No voice is available.'); };
  return (
    <div className="card speech-svc" data-testid="speech-service">
      <div><b>Speech services (optional)</b> — a speech service gives NEXUS a generated voice whose mouth follows the real audio, and voice input that also works in the desktop app. Any OpenAI-compatible audio API works (hosted or on this computer).</div>
      <div className="small" role="status">Voice: {snap.caps?.speech?.tts.configured ? '✓ ' : '— '}{pub.tts.note}<br />Voice input: {snap.caps?.speech?.stt.configured ? '✓ ' : '— '}{pub.stt.note}</div>
      <fieldset className="field"><legend>Spoken replies (text-to-speech)</legend>
        <label className="field">Service<select {...F('ttsProvider')}><option value="none">Off — use this computer's voices</option><option value="openai">OpenAI-compatible speech API</option></select></label>
        {f.ttsProvider === 'openai' && <>
          <label className="field">Base URL<input {...F('ttsBaseUrl')} placeholder="https://api.openai.com/v1 or a local speech server" /></label>
          <label className="field">Speech model<input {...F('ttsModel')} placeholder="a speech model id from your provider" /></label>
          <label className="field">Voice name<input {...F('ttsVoice')} placeholder="a voice name from your provider" /></label>
          <label className="field">API key {pub.tts.apiKey.set ? <span className="muted">(set {pub.tts.apiKey.hint} — leave blank to keep)</span> : <span className="muted">(not set; not needed for local servers)</span>}<input type="password" autoComplete="off" {...F('ttsApiKey')} /></label>
        </>}
      </fieldset>
      <fieldset className="field"><legend>Voice input (transcription)</legend>
        <label className="field">Service<select {...F('sttProvider')}><option value="none">Off — use the browser's recognition</option><option value="openai">OpenAI-compatible transcription API</option></select></label>
        {f.sttProvider === 'openai' && <>
          <label className="field">Base URL<input {...F('sttBaseUrl')} placeholder="https://api.openai.com/v1 or a local whisper server" /></label>
          <label className="field">Transcription model<input {...F('sttModel')} placeholder="a transcription model id from your provider" /></label>
          <label className="field">Language (optional)<input {...F('sttLanguage')} placeholder="e.g. en — blank lets the service detect it" /></label>
          <label className="field">API key {pub.stt.apiKey.set ? <span className="muted">(set {pub.stt.apiKey.hint} — leave blank to keep)</span> : <span className="muted">(not set; not needed for local servers)</span>}<input type="password" autoComplete="off" {...F('sttApiKey')} /></label>
        </>}
      </fieldset>
      <div className="row wrap"><button className="primary" onClick={() => void save()} disabled={!allowed}>Save speech settings</button><button onClick={test} disabled={!companion.tts.supported}>Test voice</button></div>
      {msg && <div className="small" role="status">{msg}</div>}
      <p className="muted small">Recorded speech is sent to the transcription service only after you press the microphone, and NEXUS does not keep the audio. Hosted speech services may charge per use.</p>
    </div>
  );
}

export default function SettingsPanel() {
  useStore(memory); const snap = useSnapshot();
  const s = memory.settings;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => companion.tts.voices());
  const [perm, setPerm] = useState<string>(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  useEffect(() => { if (!companion.tts.supported) return; const u = () => setVoices(companion.tts.voices()); speechSynthesis.addEventListener('voiceschanged', u); return () => speechSynthesis.removeEventListener('voiceschanged', u); }, []);
  const up = (p: Partial<Settings>) => void memory.updateSettings(p).then(() => companion.applySettings()).catch((e) => companion.notifications.push('error', (e as Error).message, { essential: true }));
  const T = ({ k, label, disabled }: { k: keyof Settings; label: string; disabled?: boolean }) => <label className="toggle"><input type="checkbox" checked={!!s[k]} disabled={disabled} onChange={(e) => up({ [k]: e.target.checked } as Partial<Settings>)} /> {label}</label>;
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetMsg, setResetMsg] = useState('');
  return (
    <div className="settings">
      <h4 id="personalization">Personalization</h4>
      <div className="card identity-card">
        <div className="row"><div><div className="muted small">Robot name</div><div className="identity-name">{s.robotName}</div></div><span className="spacer" /><button onClick={openRenameDialog}>Edit name</button></div>
        {s.robotName !== 'NEXUS' && <button className="link" onClick={() => void companion.renameRobot('NEXUS')}>Restore the default name (NEXUS)</button>}
        <div className="muted small">The product stays NEXUS; this is your robot's own name, used in the app and in how the AI introduces itself.</div>
      </div>
      <label className="field">Resting face<select value={s.defaultExpression} onChange={(e) => up({ defaultExpression: e.target.value as Settings['defaultExpression'] })}><option value="neutral">Neutral</option><option value="happy">Happy</option><option value="curious">Curious</option><option value="determined">Determined</option><option value="sleepy">Sleepy</option></select></label>
      <label className="field">Greeting<select value={s.greetingStyle} onChange={(e) => up({ greetingStyle: e.target.value as Settings['greetingStyle'] })}><option value="greeting">Hop and wave</option><option value="wave">Simple wave</option><option value="bounce">Excited bounce</option><option value="nod">Polite nod</option><option value="none">No greeting</option></select></label>
      <T k="dailyGreeting" label="Say good morning / afternoon once a day, with today's reminders" />
      <T k="ambientBehaviours" label="Little idle behaviours now and then (look around, stretch, antenna wiggle)" disabled={s.reducedMotion || s.quietMode} />
      <T k="greetEverySession" label="Greet me every time I open the app (otherwise only the first time)" disabled={s.greetingStyle === 'none'} />
      <label className="field">Idle liveliness<select value={s.idleLevel} onChange={(e) => up({ idleLevel: e.target.value as Settings['idleLevel'] })} disabled={s.reducedMotion}><option value="off">Still</option><option value="calm">Calm</option><option value="normal">Normal</option><option value="lively">Lively</option></select>{s.reducedMotion && <span className="muted small">Reduced motion is on, so the robot stays still while idle.</span>}</label>
      <div className="row wrap">
        <button onClick={openSetup}>Run setup again</button>
        {!confirmReset
          ? <button onClick={() => { setConfirmReset(true); setResetMsg(''); }}>Reset personalization…</button>
          : <div className="card warn confirm" role="alertdialog" aria-label="Confirm reset">
              <p>Reset the name to “NEXUS” and restore the default face, greeting, liveliness, animation intensity and appearance? Conversation, memories, skills and model settings are not affected.</p>
              <div className="row"><button className="danger" onClick={async () => { try { await memory.resetPersonalization(); companion.applySettings(); setResetMsg('Personalization reset to defaults.'); } catch (e) { setResetMsg((e as Error).message); } setConfirmReset(false); }}>Reset</button><button onClick={() => setConfirmReset(false)}>Cancel</button></div>
            </div>}
        {resetMsg && <span className="small" role="status">{resetMsg}</span>}
      </div>
      <h4>Model</h4><ModelPanel />
      <h4>Conversation</h4>
      <label className="field">Response style<select value={s.responseStyle} onChange={(e) => up({ responseStyle: e.target.value as Settings['responseStyle'] })}><option value="concise">Concise</option><option value="balanced">Balanced</option><option value="detailed">Detailed</option></select></label>
      <label className="field">Language<input value={s.language} maxLength={40} onChange={(e) => up({ language: e.target.value || 'English' })} /></label>
      <T k="streaming" label="Stream replies when the provider supports it" />
      <label className="field">History sent to the model: last {s.historyLimit} messages<input type="range" min={2} max={40} step={2} value={s.historyLimit} onChange={(e) => up({ historyLimit: Number(e.target.value) })} /></label>
      <h4>Animation & appearance</h4>
      <label className="field">Layout<select value={s.layout} onChange={(e) => up({ layout: e.target.value as Settings['layout'] })}><option value="robot">Robot view — the robot fills the window, voice first</option><option value="workspace">Workspace — robot, chat and panels side by side</option></select></label>
      <label className="field">Robot size on the stage<select value={s.robotSize} onChange={(e) => up({ robotSize: e.target.value as Settings['robotSize'] })}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
      <label className="field">Theme<select value={s.theme} onChange={(e) => up({ theme: e.target.value as Settings['theme'] })}><option value="dark">Dark</option><option value="light">Light</option><option value="system">Match my computer</option></select></label>
      <label className="field">Animation intensity ×{s.animationIntensity.toFixed(2)}<input type="range" min={0.3} max={1.3} step={0.05} value={s.animationIntensity} onChange={(e) => up({ animationIntensity: Number(e.target.value) })} /></label>
      <T k="playfulReactions" label="Playful reactions (winks, celebrations)" />
      <T k="completionReaction" label="Small nod when a reply completes" />
      <label className="field">Environment<select value={s.environment} onChange={(e) => up({ environment: e.target.value as Settings['environment'] })}><option value="lab">Dark lab</option><option value="grid">Grid</option><option value="transparent">Transparent</option></select></label>
      <T k="effects" label="Glow & ambient effects" />
      <fieldset className="field"><legend>Accessories</legend>{(Object.keys(s.accessories) as (keyof Settings['accessories'])[]).map((k) => <label key={k} className="toggle"><input type="checkbox" checked={s.accessories[k]} onChange={(e) => up({ accessories: { ...s.accessories, [k]: e.target.checked } })} /> {k.replace(/([A-Z])/g, ' $1').toLowerCase()}</label>)}</fieldset>
      <h4>Voice</h4>
      <T k="voiceOutput" label={`Spoken replies${companion.tts.supported ? '' : ' (unsupported in this browser)'}`} disabled={!companion.tts.supported} />
      <label className="field">Voice<select value={s.voiceURI ?? ''} onChange={(e) => up({ voiceURI: e.target.value || null })} disabled={!voices.length}><option value="">Automatic</option>{voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}</select></label>
      <label className="field">Speech rate ×{s.speechRate.toFixed(2)}<input type="range" min={0.6} max={1.6} step={0.05} value={s.speechRate} onChange={(e) => up({ speechRate: Number(e.target.value) })} /></label>
      <label className="field">Voice engine<select value={s.voiceEngine} onChange={(e) => up({ voiceEngine: e.target.value as Settings['voiceEngine'] })}><option value="auto">Automatic — the speech service when configured, else this computer</option><option value="server">Speech service (when configured)</option><option value="browser">This computer / browser only</option></select></label>
      <div className="muted small" data-testid="voice-engines">Replies use: {companion.voiceOut?.engineName ?? 'browser'} voice · mouth: {companion.voiceOut?.lipSync ?? 'n/a'} · voice input: {companion.voiceIn?.kind ?? 'browser'}</div>
      <T k="speakingMouth" label="Move the robot's mouth while it speaks (follows the audio level with a speech service; otherwise word timing — an approximation, not phoneme lip-sync)" />
      <T k="reviewTranscript" label="Let me review recognised speech before sending" />
      <div className="muted small">Microphone: {snap.mic}. {companion.voiceIn?.kind === 'server' ? 'Recognition is done by the configured transcription service.' : 'Recognition is provided by your browser; some browsers send audio to their vendor\'s servers.'}</div>
      <SpeechServicePanel />
      <h4>Notifications & quiet mode</h4>
      <T k="quietMode" label="Quiet mode — mute sounds and optional reactions (errors and status still show)" />
      <T k="sounds" label="Soft UI sounds" />
      <T k="notificationReactions" label="Robot reacts to notifications" />
      <label className="toggle"><input type="checkbox" checked={s.desktopNotifications} onChange={async (e) => { if (e.target.checked) { const p = await companion.notifications.requestDesktopPermission(); setPerm(p); if (p !== 'granted') return; } up({ desktopNotifications: e.target.checked }); }} /> Desktop notification when a reply finishes in a background tab (permission: {perm})</label>
      <h4>Accessibility</h4>
      <T k="reducedMotion" label="Reduced motion (smaller, fewer movements; no idle sway)" />
      <T k="highContrast" label="High contrast" />
      <T k="largeText" label="Larger text" />
      <h4>Keyboard</h4>
      <table className="keys"><tbody>
        <tr><td><kbd>/</kbd></td><td>Jump to the message box</td></tr>
        <tr><td><kbd>Enter</kbd> · <kbd>Shift</kbd>+<kbd>Enter</kbd></td><td>Send · new line</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>Close the panel drawer, otherwise stop speaking / moving / cancel the reply</td></tr>
        <tr><td><kbd>Alt</kbd>+<kbd>1</kbd>…<kbd>6</kbd></td><td>Open Chats, Skills, Memory, Reminders, Settings, Status</td></tr>
        <tr><td><kbd>Alt</kbd>+<kbd>P</kbd></td><td>Show / hide the panel</td></tr>
      </tbody></table>
      <h4>Privacy</h4>
      <T k="memoryEnabled" label="Persistent memory" />
      <T k="saveChats" label="Save chats on this device (so they survive reloads and appear in Chats)" />
      {!s.saveChats && <button className="link danger" onClick={() => void chats.removeAll().then(() => companion.notifications.push('info', 'All saved chats were deleted from this computer.', { react: false }))}>Delete all saved chats</button>}
      <T k="diagnosticsIncludeContent" label="Include (redacted) message text in diagnostics — off by default" />
    </div>
  );
}
