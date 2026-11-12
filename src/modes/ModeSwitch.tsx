/**
 * The mode selector button in the top bar: shows the active mode at all times. Its panel (five mode cards and the
 * active mode's setting) is a separate chunk loaded the first time it is opened.
 */
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { memory } from '../core/runtime';
import { useStore } from '../components/hooks';
import { resolveMode } from '../../shared/modes';
import './accents.css';

const ModeLauncher = lazy(() => import('./ModeLauncher'));

export function ModeSwitch() {
  useStore(memory);
  const m = resolveMode(memory.settings.mode);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btn.current?.focus(); } };
    window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true);
  }, [open]);
  return (
    <div className="mode-switch">
      <button ref={btn} type="button" className="mode-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open} data-testid="mode-button" title={`${m.name} mode — ${m.tagline}. Change mode`}>
        <Icon name={m.icon as IconName} /><span className="mode-btn-label"><span className="sr-only">Mode: </span>{m.name}</span>
      </button>
      {open && (
        <Suspense fallback={<div className="mode-panel" role="status">Loading modes…</div>}>
          <ModeLauncher onClose={() => { setOpen(false); btn.current?.focus(); }} />
        </Suspense>
      )}
    </div>
  );
}
