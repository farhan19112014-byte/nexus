/**
 * The stage robot: the 3D NEXUS. Whether WebGL works is decided BEFORE three.js is downloaded, so a browser without
 * WebGL never fetches the 3D code; it gets a short note in the robot's place instead. `onFallback` is called whenever
 * 3D was attempted and failed (a Retry is offered when the model could not load).
 * Gives the animation runtime ONE stable RigHandle that forwards to the robot once it is showing, so a retry never
 * interrupts expressions, gestures or speech.
 */
import { forwardRef, lazy, Suspense, useImperativeHandle, useRef, useState } from 'react';
import type { Channel } from '../../shared/channels';
import type { Indicator, RigHandle, RobotProps } from '../character/Robot';
import { webglAvailable } from './webgl';
import type { MotionState } from './motion3d';

const Robot3D = lazy(() => import('./Robot3D').then((m) => ({ default: m.Robot3D })));

export const RobotAuto = forwardRef<RigHandle, RobotProps & { onFallback?: (reason: string) => void; onReady3d?: () => void; orbit?: number }>(function RobotAuto({ onFallback, onReady3d, orbit, ...props }, ref) {
  const inner = useRef<RigHandle | null>(null);
  const last = useRef<{ v: Record<Channel, number> | null; ind: Indicator; seat: boolean; motion: MotionState; reduced: boolean }>({ v: null, ind: 'idle', seat: false, motion: 'idle', reduced: false });
  const [failed, setFailed] = useState<string | null>(null);
  const bind = (r: RigHandle | null) => { inner.current = r; if (r) { r.setIndicator(last.current.ind); r.setSeat(last.current.seat); r.setMotion?.(last.current.motion, last.current.reduced); if (last.current.v) r.apply(last.current.v); } };
  useImperativeHandle(ref, () => ({
    apply(v) { last.current.v = v; inner.current?.apply(v); },
    setIndicator(i) { last.current.ind = i; inner.current?.setIndicator(i); },
    setSeat(on) { last.current.seat = on; inner.current?.setSeat(on); },
    setMotion(m, reduced) { last.current.motion = m; last.current.reduced = reduced; inner.current?.setMotion?.(m, reduced); },
    setBody(o) { inner.current?.setBody?.(o); },
    busy: () => inner.current?.busy?.() ?? false,
    attentionTargets: () => inner.current?.attentionTargets?.() ?? null,
  }), []);
  const [attempt, setAttempt] = useState(0);
  const label = props.title ?? 'NEXUS';
  const cls = `robot3d robot-unavailable ${props.className ?? ''}`;
  if (!webglAvailable()) return <div className={cls} role="img" aria-label={label} data-ready="unavailable" data-testid="robot-unavailable"><p className="robot-retry" role="status">The 3D robot needs WebGL, which this browser or device does not provide.</p></div>;
  if (failed) return (
    <div className={cls} role="img" aria-label={label} data-ready="unavailable" data-testid="robot-unavailable">
      <p className="robot-retry" role="status">3D view unavailable.{/model could not be loaded|failed to start/.test(failed) && <> <button type="button" onClick={() => { setFailed(null); setAttempt((n) => n + 1); }}>Retry 3D</button></>}</p>
    </div>
  );
  return (
    // while the 3D code downloads: an honest "loading" placeholder
    <Suspense fallback={<div className={`robot3d ${props.className ?? ''}`} role="img" aria-label={label} aria-busy="true" />}>
      <Robot3D key={attempt} ref={bind} {...props} orbit={orbit} onReady={onReady3d} onFail={(why) => { setFailed(why); onFallback?.(why); }} />
    </Suspense>
  );
});
