/**
 * Asset 08 verification view: renders every expression and every pose with the SAME rig and
 * geometry, so inconsistencies (misplaced features, broken joints) are visible side by side.
 * Open with ?sheet=1. Each cell is stepped deterministically (seeded RNG, fixed dt).
 */
import { useEffect, useRef } from 'react';
import { Robot, type RigHandle } from '../character/Robot';
import { AnimationEngine, seeded } from '../animation/engine';
import { ExpressionController } from '../expressions/expressionController';
import { BUILTIN_EXPRESSIONS } from '../expressions/presets';
import { POSE_IDS } from '../character/poses';
import { BUILTIN_MOTIONS } from '../animation/builtinMotions';
import type { Pose } from '../../shared/schema';

function Cell({ label, expression, pose, motion, at = 1 }: { label: string; expression?: string; pose?: Pose; motion?: string; at?: number }) {
  const rig = useRef<RigHandle>(null);
  useEffect(() => {
    const e = new AnimationEngine(seeded(7)); e.idleEnabled = false; e.rateLimit = false;
    const x = new ExpressionController(BUILTIN_EXPRESSIONS);
    e.setFaceSource(x);
    if (expression) x.set('user', expression);
    if (pose) e.setPose(pose, true);
    if (motion) e.play(BUILTIN_MOTIONS.find((m) => m.id === motion)!);
    for (let t = 0; t < at; t += 1 / 60) { x.update(1 / 60); e.update(1 / 60); }
    rig.current?.apply(e.values);
    rig.current?.setSeat(pose === 'sitting');
  }, [expression, pose, motion, at]);
  return (
    <figure className="sheet-cell">
      <Robot ref={rig} environment="transparent" effects={false} seat={pose === 'sitting'} />
      <figcaption>{label}</figcaption>
    </figure>
  );
}

export default function CharacterSheet() {
  return (
    <main className="sheet">
      <h1>NEXUS character sheet</h1>
      <h2>Expressions</h2>
      <div className="sheet-grid">{BUILTIN_EXPRESSIONS.map((e) => <Cell key={e.id} label={e.name} expression={e.id} />)}</div>
      <h2>Poses</h2>
      <div className="sheet-grid">{POSE_IDS.map((p) => <Cell key={p} label={p} pose={p} />)}</div>
      <h2>Motions (mid-clip)</h2>
      <div className="sheet-grid">{BUILTIN_MOTIONS.map((m) => <Cell key={m.id} label={m.name} motion={m.id} at={Math.min(m.duration * 0.45, 1.2)} />)}</div>
    </main>
  );
}
