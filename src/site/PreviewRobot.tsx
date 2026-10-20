/**
 * The real NEXUS robot (same SVG rig, engine, expressions and built-in motions as the workspace) for the
 * public pages. It runs its OWN small engine so the homepage never disturbs the companion's state, pauses
 * when scrolled off-screen or when the tab is hidden, and plays nothing automatically under reduced motion.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Robot, type RigHandle } from '../character/Robot';
import { AnimationEngine, seeded } from '../animation/engine';
import { ExpressionController } from '../expressions/expressionController';
import { BUILTIN_EXPRESSIONS } from '../expressions/presets';
import { BUILTIN_MOTIONS } from '../animation/builtinMotions';

export interface PreviewHandle { play(motionId: string): Promise<boolean>; express(id: string, seconds?: number): boolean; reset(): void; busy(): boolean }
interface Props { title: string; greet?: boolean; face?: string; className?: string; onActivity?: (label: string | null) => void }

export const reducedMotionPreferred = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOTIONS = new Map(BUILTIN_MOTIONS.map((m) => [m.id, m]));

export const PreviewRobot = forwardRef<PreviewHandle, Props>(function PreviewRobot({ title, greet, face, className, onActivity }, ref) {
  const rig = useRef<RigHandle>(null);
  const box = useRef<HTMLDivElement>(null);
  const [parts] = useState(() => {
    const engine = new AnimationEngine(seeded(7));
    const expressions = new ExpressionController(BUILTIN_EXPRESSIONS);
    engine.setFaceSource(expressions);
    return { engine, expressions };
  });
  const { engine, expressions } = parts;
  const playing = useRef<string | null>(null);

  useImperativeHandle(ref, () => ({
    async play(id) {
      const def = MOTIONS.get(id); if (!def) return false;
      engine.stopAll(); playing.current = def.name; onActivity?.(def.name);
      const r = await engine.play(def, { conflict: 'interrupt' }).done;
      if (playing.current === def.name) { playing.current = null; onActivity?.(null); }
      return r === 'completed';
    },
    express(id, seconds = 2.6) {
      if (!expressions.ids().includes(id)) return false;
      expressions.set('user', id, 1, seconds); onActivity?.(BUILTIN_EXPRESSIONS.find((e) => e.id === id)?.name ?? id);
      setTimeout(() => onActivity?.(null), seconds * 1000);
      return true;
    },
    reset() { engine.reset(); expressions.release('user'); playing.current = null; onActivity?.(null); },
    busy: () => playing.current !== null,
  }), [engine, expressions, onActivity]);

  useEffect(() => {
    const reduce = reducedMotionPreferred();
    engine.reducedMotion = reduce; engine.idleEnabled = !reduce;
    let raf = 0, last = 0, visible = true, running = false;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      expressions.update(dt); engine.blinkRate = expressions.blinkRate();
      rig.current?.apply(engine.update(dt));
      raf = requestAnimationFrame(frame);
    };
    const start = () => { if (running || !visible || document.hidden) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); };
    const stop = () => { running = false; cancelAnimationFrame(raf); };
    if (face) expressions.set('system', face, 1, null);
    rig.current?.apply(engine.update(0));
    const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); else stop(); }) : null;
    if (box.current && io) io.observe(box.current);
    const vis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', vis);
    start();
    let greetT: ReturnType<typeof setTimeout> | null = null;
    if (greet && !reduce) greetT = setTimeout(() => { const g = MOTIONS.get('greeting'); if (g) void engine.play(g).done; expressions.set('reaction', 'happy', 0.8, 2.4); }, 600);
    return () => { stop(); io?.disconnect(); document.removeEventListener('visibilitychange', vis); if (greetT) clearTimeout(greetT); engine.stopAll(); };
  }, [engine, expressions, greet, face]);

  return (
    <div ref={box} className={className} onPointerMove={(e) => { const r = box.current!.getBoundingClientRect(); engine.lookAt(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1.1, 'user'); }} onPointerLeave={() => engine.lookAt(null)}>
      <Robot ref={rig} environment="transparent" effects accessories={{ antenna: true, sidePanels: true, chestLight: true, cheekLights: true, foreheadIndicator: true }} title={title} className="preview-svg" />
    </div>
  );
});
