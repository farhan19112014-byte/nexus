/**
 * The real NEXUS robot (the 3D model where WebGL works, else the 2D rig — same engine, expressions and built-in
 * motions as the workspace) for the public pages. It runs its OWN small engine so the homepage never disturbs the companion's state, pauses
 * when scrolled off-screen or when the tab is hidden, and plays nothing automatically under reduced motion.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Indicator, RigHandle } from '../character/Robot';
import { RobotAuto } from '../character3d/RobotAuto';
import { effectiveStyle, type RobotStyle } from '../character3d/webgl';
import { AnimationEngine, seeded } from '../animation/engine';
import { ExpressionController } from '../expressions/expressionController';
import { BUILTIN_EXPRESSIONS } from '../expressions/presets';
import { BUILTIN_MOTIONS } from '../animation/builtinMotions';

export interface PreviewHandle { play(motionId: string): Promise<boolean>; express(id: string, seconds?: number): boolean; state(id: DemoState): void; reset(): void; busy(): boolean }
interface Props { title: string; greet?: boolean; face?: string; className?: string; mode?: RobotStyle; onActivity?: (label: string | null) => void; onReady?: () => void }

/** The companion's states, shown on the public page with the same faces, lights and poses the app uses for them. */
export const DEMO_STATES = [
  { id: 'idle', label: 'Idle', face: null, light: 'idle', note: 'Calm, blinking, looking around now and then.' },
  { id: 'listening', label: 'Listening', face: 'listening', light: 'listening', note: 'While the microphone is capturing.' },
  { id: 'thinking', label: 'Thinking', face: 'thinking', light: 'processing', note: 'While a request is being processed.' },
  { id: 'speaking', label: 'Speaking', face: 'speaking', light: 'speaking', note: 'While a reply is read aloud (silent in this preview).' },
  { id: 'curious', label: 'Curious', face: 'curious', light: 'idle', note: 'When you are typing a question.' },
  { id: 'confused', label: 'Confused', face: 'confused', light: 'idle', note: 'When a reply came back empty or unreadable, or nothing was heard.' },
  { id: 'resting', label: 'Resting', face: 'resting', light: 'idle', note: 'After a while without activity (it still works).' },
  { id: 'error', label: 'Error', face: 'error', light: 'error', note: 'When something really failed — always with an explanation.' },
] as const satisfies readonly { id: string; label: string; face: string | null; light: Indicator; note: string }[];
export type DemoState = (typeof DEMO_STATES)[number]['id'];

export const reducedMotionPreferred = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOTIONS = new Map(BUILTIN_MOTIONS.map((m) => [m.id, m]));

export const PreviewRobot = forwardRef<PreviewHandle, Props>(function PreviewRobot({ title, greet, face, className, mode = 'auto', onActivity, onReady }, ref) {
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
  const is3d = useRef(false);
  const picked = useRef(false);

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
    state(id) {
      const d = DEMO_STATES.find((x) => x.id === id); if (!d) return;
      picked.current = true;
      engine.stopAll(); engine.setSpeaking(false); engine.setPose(id === 'resting' ? 'resting' : 'neutral'); engine.lookAt(id === 'listening' ? 0 : null, 0);
      expressions.release('user'); expressions.release('reaction');
      if (d.face) expressions.set('system', d.face, 1, null, 3); else expressions.release('system');
      if (id === 'speaking') engine.setSpeaking(true);                    // procedural mouth movement — no audio on this page
      // the 3D robot's motion engine gives each state its body language; the 2D fallback keeps the old waiting loop
      rig.current?.setMotion?.(id, engine.reducedMotion);
      if (id === 'thinking' && !engine.reducedMotion && !is3d.current) { const w = MOTIONS.get('waiting'); if (w) void engine.play(w).done; }
      rig.current?.setIndicator(d.light);
      playing.current = null; onActivity?.(d.label);
    },
    reset() { rig.current?.setMotion?.('idle', engine.reducedMotion); engine.reset(); engine.setSpeaking(false); expressions.release('user'); if (!face) expressions.release('system'); rig.current?.setIndicator('idle'); playing.current = null; onActivity?.(null); },
    busy: () => playing.current !== null,
  }), [engine, expressions, onActivity, face]);

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
    // hello: on the 2D fallback the classic greeting motion; the 3D robot greets with its own motion engine when ready
    if (greet && !reduce && effectiveStyle(mode) === '2d') greetT = setTimeout(() => { const g = MOTIONS.get('greeting'); if (g) void engine.play(g).done; expressions.set('reaction', 'happy', 0.8, 2.4); }, 600);
    return () => { stop(); io?.disconnect(); document.removeEventListener('visibilitychange', vis); if (greetT) clearTimeout(greetT); engine.stopAll(); };
  }, [engine, expressions, greet, face, mode]);

  return (
    <div ref={box} className={className} onPointerMove={(e) => { const r = box.current!.getBoundingClientRect(); engine.lookAt(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1.1, 'user'); }} onPointerLeave={() => engine.lookAt(null)}>
      <RobotAuto ref={rig} mode={mode} onReady3d={() => { is3d.current = true; engine.bodyIdle = false; const r = engine.reducedMotion; rig.current?.setMotion?.(greet && !r ? 'curious' : 'idle', r); if (greet && !r) { expressions.set('reaction', 'happy', 0.8, 2.4); setTimeout(() => { if (!picked.current) rig.current?.setMotion?.('idle', r); }, 2600); } onReady?.(); }} environment="transparent" effects accessories={{ antenna: true, sidePanels: true, chestLight: true, cheekLights: true, foreheadIndicator: true }} title={title} className="preview-svg" />
    </div>
  );
});
