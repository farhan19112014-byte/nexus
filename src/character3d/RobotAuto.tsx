/**
 * The stage robot: the 3D NEXUS or the classic 2D NEXUS (Settings → Animation & appearance → Robot style).
 * mode "auto" shows 3D where WebGL works and the 2D robot otherwise — decided BEFORE three.js is downloaded, so a
 * browser without WebGL never fetches the 3D code. `onFallback` is called whenever 3D was attempted and failed.
 * Gives the animation runtime ONE stable RigHandle that forwards to whichever robot is showing, so switching style
 * (or falling back to 2D when WebGL is unavailable) never interrupts expressions, gestures or speech.
 */
import { forwardRef, lazy, Suspense, useImperativeHandle, useRef, useState } from 'react';
import type { Channel } from '../../shared/channels';
import { Robot, type Indicator, type RigHandle, type RobotProps } from '../character/Robot';
import { effectiveStyle, type RobotStyle } from './webgl';
import type { MotionState } from './motion3d';

const Robot3D = lazy(() => import('./Robot3D').then((m) => ({ default: m.Robot3D })));

export const RobotAuto = forwardRef<RigHandle, RobotProps & { mode: RobotStyle; onFallback?: (reason: string) => void; onReady3d?: () => void }>(function RobotAuto({ mode, onFallback, onReady3d, ...props }, ref) {
  const inner = useRef<RigHandle | null>(null);
  const last = useRef<{ v: Record<Channel, number> | null; ind: Indicator; seat: boolean; motion: MotionState; reduced: boolean }>({ v: null, ind: 'idle', seat: false, motion: 'idle', reduced: false });
  const [failed, setFailed] = useState<string | null>(null);
  const bind = (r: RigHandle | null) => { inner.current = r; if (r) { r.setIndicator(last.current.ind); r.setSeat(last.current.seat); r.setMotion?.(last.current.motion, last.current.reduced); if (last.current.v) r.apply(last.current.v); } };
  useImperativeHandle(ref, () => ({
    apply(v) { last.current.v = v; inner.current?.apply(v); },
    setIndicator(i) { last.current.ind = i; inner.current?.setIndicator(i); },
    setSeat(on) { last.current.seat = on; inner.current?.setSeat(on); },
    svg: () => inner.current?.svg() ?? null,
    setMotion(m, reduced) { last.current.motion = m; last.current.reduced = reduced; inner.current?.setMotion?.(m, reduced); },
    busy: () => inner.current?.busy?.() ?? false,
  }), []);
  const flat = <Robot ref={bind} {...props} />;
  if (effectiveStyle(mode) === '2d' || failed) return flat;
  return (
    // while the 3D code downloads: an honest "loading" placeholder (no flash of the 2D robot); 2D only if 3D fails
    <Suspense fallback={<div className={`robot3d ${props.className ?? ''}`} role="img" aria-label={props.title ?? 'NEXUS'} aria-busy="true" />}>
      <Robot3D ref={bind} {...props} onReady={onReady3d} onFail={(why) => { setFailed(why); onFallback?.(why); }} />
    </Suspense>
  );
});
