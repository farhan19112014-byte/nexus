/** Main companion stage: the robot, pointer-driven gaze (Asset 23), live status text and body controls. */
import { Icon } from './Icon';
import { useCallback, useEffect, useRef } from 'react';
import { Robot, type RigHandle } from '../character/Robot';
import { companion, engine, expressions, memory, runtime } from '../core/runtime';
import { usePoll, useSnapshot, useStore } from './hooks';

const STATE_TEXT: Record<string, string> = {
  idle: 'Ready', greeting: 'Saying hello', listening: 'Listening — microphone on', processing: 'Waiting for the AI…', responding: 'Replying',
  speaking: 'Speaking', paused: 'Paused', acting: 'Moving', interrupted: 'Interrupted', error: 'Something went wrong', recovering: 'Recovering', resting: 'Resting (still available)',
};

/** compact: robot view — only the state line; movement controls live in the voice dock */
export default function Stage({ compact = false }: { compact?: boolean }) {
  const rig = useRef<RigHandle>(null);
  const box = useRef<HTMLDivElement>(null);
  const snap = useSnapshot();
  useStore(memory);
  const s = memory.settings;
  const accKey = JSON.stringify(s.accessories);
  useEffect(() => { if (!rig.current) return; const off = runtime.attach(rig.current); runtime.start(); return () => { off(); }; }, [s.environment, s.effects, accKey]);
  const live = usePoll(useCallback(() => ({ acts: engine.active().filter((a) => a.phase !== 'out' && !a.preview).map((a) => a.name), expr: expressions.current(), pose: engine.getPose() }), []), 200);
  useEffect(() => { rig.current?.setSeat(live.pose === 'sitting'); }, [live.pose]);
  const onMove = (e: React.PointerEvent) => {
    if (snap.state === 'listening' || snap.state === 'responding') return;
    const r = box.current!.getBoundingClientRect();
    engine.lookAt(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1.1, 'user');
  };
  return (
    <section className={`stage${compact ? ' compact' : ''}`} aria-label={`${s.robotName}, your robot`}>
      <div className={`stage-box env-${s.environment} size-${s.robotSize}`} ref={box} onPointerMove={onMove} onPointerLeave={() => engine.lookAt(null)}>
        <Robot ref={rig} environment={s.environment} effects={s.effects && !s.highContrast} accessories={s.accessories} className="robot" title={`${s.robotName} — ${STATE_TEXT[snap.state] ?? snap.state}, expression ${live.expr}`} />
        <div className="stage-status" role="status" aria-live="polite">
          <span className={`dot st-${snap.state}`} aria-hidden /> {STATE_TEXT[snap.state] ?? snap.state}
          {!compact && <span className="muted"> · face: {live.expr}{live.acts.length ? ` · ${live.acts.join(', ')}` : ''}</span>}
          {snap.preview && <span className="muted" data-testid="previewing"> · previewing “{snap.preview.name}” in the sandbox</span>}
        </div>
      </div>
      {!compact && <div className="stage-controls" role="toolbar" aria-label="Body controls">
        <button onClick={() => companion.stopAction()} title="Stop the current movement (Esc)"><Icon name="stop" /> Stop action</button>
        <button onClick={() => companion.resetCharacter()} title="Stop everything and return to neutral"><Icon name="reset" /> Reset character</button>
      </div>}
    </section>
  );
}
