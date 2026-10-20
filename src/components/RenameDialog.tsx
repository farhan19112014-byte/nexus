/** Section 6 — "Give your robot a name": accessible modal (native <dialog>: focus trap, Esc to cancel), live preview, inline validation. */
import { useEffect, useId, useRef, useState } from 'react';
import { companion } from '../core/runtime';
import { ROBOT_NAME_MAX, nameLength, validateRobotName } from '../../shared/identity';

export function RenameDialog({ open, onClose }: { open: boolean; onClose: (saved?: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(companion.robotName);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const ids = { title: useId(), desc: useId(), err: useId(), count: useId() };
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement;
      setValue(companion.robotName); setError(''); setTouched(false); setSaving(false);
      if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
      requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); });
    } else if (!open && d.open) {
      d.close();
      (opener.current as HTMLElement | null)?.focus?.();
    }
  }, [open]);

  const check = validateRobotName(value);
  const shownError = error || (touched && !check.ok ? check.error : '');
  const preview = check.ok ? check.name : companion.robotName;
  const save = async () => {
    setTouched(true);
    if (!check.ok) { setError(check.error); input.current?.focus(); return; }
    if (saving) return;
    setSaving(true); setError('');
    const r = await companion.renameRobot(value);
    setSaving(false);
    if (r.ok) onClose(r.name); else { setError(r.error); input.current?.focus(); }
  };

  return (
    <dialog ref={ref} className="modal" aria-labelledby={ids.title} aria-describedby={ids.desc} onCancel={(e) => { e.preventDefault(); if (!saving) onClose(); }}>
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h2 id={ids.title}>Give your robot a name</h2>
        <p id={ids.desc} className="muted">This is what your robot is called in the app and how it introduces itself. The product stays “NEXUS”, and your conversation, memories and skills are kept.</p>
        <label className="field" htmlFor="robot-name-input">Name
          <input id="robot-name-input" ref={input} value={value} autoComplete="off" spellCheck={false} maxLength={ROBOT_NAME_MAX * 4}
            aria-invalid={!!shownError} aria-describedby={`${shownError ? ids.err : ''} ${ids.count}`.trim()}
            onChange={(e) => { setValue(e.target.value); setError(''); }} onBlur={() => setTouched(true)} />
        </label>
        <div className="row small">
          {shownError ? <span id={ids.err} className="err" role="alert">{shownError}</span> : <span className="muted">Letters from any language, numbers and emoji are fine.</span>}
          <span className="spacer" />
          <span id={ids.count} className={`muted ${nameLength(value.trim()) > ROBOT_NAME_MAX ? 'err' : ''}`}>{nameLength(value.trim())}/{ROBOT_NAME_MAX}</span>
        </div>
        <div className="name-preview" aria-live="polite"><span className="muted small">Preview</span><span className="preview-greeting">“Hi! I’m <b>{preview}</b>.”</span></div>
        <div className="row modal-actions">
          <span className="spacer" />
          <button type="button" onClick={() => onClose()} disabled={saving}>Cancel</button>
          <button type="submit" className="primary" disabled={saving || (touched && !check.ok)}>{saving ? 'Saving…' : 'Save name'}</button>
        </div>
      </form>
    </dialog>
  );
}

/** Any control can open the dialog (header pencil, Settings → Personalization) — App owns the single instance. */
export const RENAME_EVENT = 'nexus:rename';
export const openRenameDialog = () => window.dispatchEvent(new Event(RENAME_EVENT));
