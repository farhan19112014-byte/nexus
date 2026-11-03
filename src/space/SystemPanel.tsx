/**
 * System status panel (robot page): truthful backend / AI / voice / interaction status, the live NEXUS chain
 * (intelligence → conversation → voice → expression → movement) and the interface-sound switch. Collapsible; on phones
 * it starts as a compact pill.
 */
import { useCallback, useState } from 'react';
import { companion, engine, expressions, memory, runtime } from '../core/runtime';
import { usePoll, useSnapshot, useStore } from '../components/hooks';
import { Icon } from '../components/Icon';
import { activeStages, systemStatus, type Stage } from './systemStatus';

const STAGES: [Stage, string][] = [['intelligence', 'Intelligence'], ['conversation', 'Conversation'], ['voice', 'Voice'], ['expression', 'Expression'], ['movement', 'Movement']];

export function SystemPanel() {
  const snap = useSnapshot(); useStore(memory); const s = memory.settings;
  const [open, setOpen] = useState(() => typeof matchMedia !== 'function' || !matchMedia('(max-width: 760px)').matches);
  const live = usePoll(useCallback(() => ({ expression: expressions.current(), moving: engine.active().some((a) => a.phase !== 'out' && !a.preview) || !['idle', 'resting'].includes(runtime.motion) }), []), 250);
  const rows = systemStatus(snap, { voiceEngine: companion.voiceOut?.engineName ?? 'browser', deviceVoice: companion.tts.supported, voiceOn: s.voiceOutput });
  const stages = activeStages(snap, live);
  const ai = rows.find((r) => r.key === 'ai');
  // never summarise as ONLINE while the AI model itself is not running (demo brain / no server)
  const worst = rows.some((r) => r.status === 'ERROR') ? 'ERROR' : rows[0].status === 'OFFLINE' ? 'OFFLINE' : ai?.status === 'OFFLINE' ? 'DEMO' : rows[rows.length - 1].status;
  const toggleSounds = () => void memory.updateSettings({ sounds: !s.sounds }).then(() => { if (!s.sounds) companion.ui.play('activate'); });
  return (
    <aside className={`system-panel${open ? ' open' : ''}`} aria-label="System status" data-testid="system-panel">
      <div className="sp-head">
        <button className="sp-toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="sp-body" title={open ? 'Collapse' : 'Show system status'}>
          <span className={`sp-dot s-${worst === 'DEMO' ? 'offline' : worst.toLowerCase()}`} aria-hidden /> <span className="sp-title">SYSTEM</span> <span className="sp-sum">{worst}</span>
        </button>
        <button className={`sp-sound${s.sounds ? ' on' : ''}`} onClick={toggleSounds} aria-pressed={s.sounds} aria-label={s.sounds ? 'Interface sounds on — mute' : 'Interface sounds off — turn on'} title="Interface sounds"><Icon name={s.sounds ? 'speaker' : 'mute'} size={15} /></button>
      </div>
      {open && <div id="sp-body">
        <ul className="sp-rows">{rows.map((r) => (
          <li key={r.key} data-key={r.key}><span className={`sp-dot s-${r.status.toLowerCase()}`} aria-hidden /><span className="sp-label">{r.label}</span><span className={`sp-status s-${r.status.toLowerCase()}`}>{r.status}</span>{r.detail && <span className="sp-detail">{r.detail}</span>}</li>))}</ul>
        <ol className="sp-chain" aria-label="What NEXUS is doing right now">{STAGES.map(([k, l]) => <li key={k} className={stages.includes(k) ? 'on' : ''} aria-current={stages.includes(k) ? 'step' : undefined}>{l}</li>)}</ol>
        {snap.activity && <p className="sp-activity"><span className="spinner" aria-hidden /> {snap.activity.kind}: {snap.activity.label}</p>}
      </div>}
    </aside>
  );
}
