/**
 * Mode selector panel: the five modes as cards (icon, name, short description, active indicator) and the active
 * mode's one setting (jurisdiction / language / learner level). Choosing a card switches at once — no reload, the
 * conversation stays. Loaded on demand.
 */
import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { companion, memory } from '../core/runtime';
import { useStore } from '../components/hooks';
import { MODE_IDS, MODES, resolveMode } from '../../shared/modes';
import './modes.css';

const OPTION_LABEL = { jurisdiction: ['Jurisdiction', 'e.g. India, England and Wales, California'], language: ['Main language / stack', 'e.g. TypeScript + React, Python'], level: ['Learner level', 'e.g. Class 8, first-year university'] } as const;

export default function ModeLauncher({ onClose }: { onClose: () => void }) {
  useStore(memory);
  const active = resolveMode(memory.settings.mode);
  const panel = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const opt = active.option;
  const [val, setVal] = useState(opt ? memory.settings.modeOptions[opt] : '');
  useEffect(() => { setVal(opt ? memory.settings.modeOptions[opt] : ''); }, [opt]);
  useEffect(() => { panel.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(); }, []);
  // closes when the pointer goes down outside the panel and its button
  useEffect(() => {
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!panel.current?.contains(t) && !(t instanceof Element && t.closest('.mode-btn'))) onClose(); };
    window.addEventListener('pointerdown', down); return () => window.removeEventListener('pointerdown', down);
  }, [onClose]);
  const choose = async (id: string) => { setBusy(true); try { await companion.setMode(id); } finally { setBusy(false); } };
  const saveOption = () => {
    if (!opt) return; const v = val.trim().slice(0, opt === 'jurisdiction' ? 60 : 40);
    if (v !== memory.settings.modeOptions[opt]) void memory.updateSettings({ modeOptions: { ...memory.settings.modeOptions, [opt]: v } }).catch((e) => companion.notifications.push('error', (e as Error).message));
  };
  // arrow keys move between cards (radio group)
  const onKey = (e: React.KeyboardEvent) => {
    const i = MODE_IDS.indexOf(active.id); const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return; e.preventDefault();
    const next = MODE_IDS[(i + d + MODE_IDS.length) % MODE_IDS.length];
    void choose(next).then(() => panel.current?.querySelector<HTMLElement>(`[data-mode-card="${next}"]`)?.focus());
  };
  return (
    <div className="mode-panel" ref={panel} role="dialog" aria-label="Choose a mode" data-testid="mode-panel">
      <div className="mode-panel-head"><b>Mode</b><span className="muted small">One NEXUS, specialised for the job. Your conversation stays when you switch.</span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close modes"><Icon name="close" /></button></div>
      <div className="mode-cards" role="radiogroup" aria-label="NEXUS modes" onKeyDown={onKey}>
        {MODE_IDS.map((id) => {
          const m = MODES[id]; const on = id === active.id;
          return (
            <button key={id} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} disabled={busy || !m.enabled} data-mode-card={id}
              className={`mode-card mc-${id}${on ? ' on' : ''}`} onClick={() => void choose(id)}>
              <span className="mc-icon" aria-hidden><Icon name={m.icon as IconName} size={20} /></span>
              <span className="mc-text"><span className="mc-name">{m.name}</span><span className="mc-desc">{m.description}</span></span>
              {on && <span className="mc-active">Active</span>}
            </button>
          );
        })}
      </div>
      {opt && (
        <label className="mode-option">
          <span>{OPTION_LABEL[opt][0]} <span className="muted small">(optional, sent with {active.name} questions)</span></span>
          <input value={val} maxLength={opt === 'jurisdiction' ? 60 : 40} placeholder={OPTION_LABEL[opt][1]} onChange={(e) => setVal(e.target.value)} onBlur={saveOption} onKeyDown={(e) => { if (e.key === 'Enter') { saveOption(); (e.target as HTMLInputElement).blur(); } }} data-testid="mode-option" />
        </label>
      )}
      {active.notice && <p className="mode-notice small" role="note">{active.notice}</p>}
    </div>
  );
}
