/**
 * The stage robot: the classic 2D NEXUS or the 3D NEXUS (Settings → Animation & appearance → Robot style).
 * Gives the animation runtime ONE stable RigHandle that forwards to whichever robot is showing, so switching style
 * (or falling back to 2D when WebGL is unavailable) never interrupts expressions, gestures or speech.
 */
import { forwardRef, lazy, Suspense, useImperativeHandle, useRef, useState } from 'react';
import type { Channel } from '../../shared/channels';
import { Robot, type Indicator, type RigHandle, type RobotProps } from '../character/Robot';

const Robot3D = lazy(() => import('./Robot3D').then((m) => ({ default: m.Robot3D })));

export const RobotAuto = forwardRef<RigHandle, RobotProps & { style3d: boolean; onFallback?: (reason: string) => void }>(function RobotAuto({ style3d, onFallback, ...props }, ref) {
  const inner = useRef<RigHandle | null>(null);
  const last = useRef<{ v: Record<Channel, number> | null; ind: Indicator; seat: boolean }>({ v: null, ind: 'idle', seat: false });
  const [failed, setFailed] = useState<string | null>(null);
  const bind = (r: RigHandle | null) => { inner.current = r; if (r) { r.setIndicator(last.current.ind); r.setSeat(last.current.seat); if (last.current.v) r.apply(last.current.v); } };
  useImperativeHandle(ref, () => ({
    apply(v) { last.current.v = v; inner.current?.apply(v); },
    setIndicator(i) { last.current.ind = i; inner.current?.setIndicator(i); },
    setSeat(on) { last.current.seat = on; inner.current?.setSeat(on); },
    svg: () => inner.current?.svg() ?? null,
  }), []);
  const flat = <Robot ref={bind} {...props} />;
  if (!style3d || failed) return flat;
  return (
    <Suspense fallback={flat}>
      <Robot3D ref={bind} {...props} onFail={(why) => { setFailed(why); onFallback?.(why); }} />
    </Suspense>
  );
});
