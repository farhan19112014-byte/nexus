/**
 * Cursor-following eyes (a micro-interaction): while NEXUS is idle, its eyes — and in 3D its head — glance toward the
 * mouse pointer when the pointer moves, then return to their own idle gaze. Limited, smoothed and polite:
 *  - only while idle (never while listening, thinking, speaking, acting, typing or resting) and never under reduced
 *    motion or quiet mode; touch input is ignored (a finger is not something to look at);
 *  - the target is clamped to a small range and eased by the animation engine (no snapping);
 *  - it reacts only to real movement (≥ 24 px), lets go ~1.8 s after the pointer stops, and after ~5 s of following it
 *    looks away for a moment — it does not stare at every cursor movement.
 * Everything goes through the engine's one gaze target, so it can never fight another animation for the eyes.
 */
import type { AnimationEngine } from '../animation/engine';
import type { CompanionState } from './stateMachine';

export interface CursorGazeDeps {
  engine: AnimationEngine;
  state: () => CompanionState;
  allowed: () => boolean;
  now?: () => number;
}
export const CURSOR_LIMITS = { x: 0.7, y: 0.45, minMovePx: 24, releaseMs: 1800, followMs: 5000, breakMs: 2200, throttleMs: 70 };

/** Pointer position relative to the robot's box → a clamped gaze target in [-1, 1]. */
export function cursorTarget(px: number, py: number, box: { left: number; top: number; width: number; height: number }): [number, number] {
  const cx = box.left + box.width / 2, cy = box.top + box.height * 0.38;   // roughly where the face is
  const nx = (px - cx) / Math.max(1, box.width * 0.9), ny = (py - cy) / Math.max(1, box.height * 0.9);
  const c = (v: number, m: number) => Math.max(-m, Math.min(m, v));
  return [c(nx, CURSOR_LIMITS.x), c(ny, CURSOR_LIMITS.y)];
}

export class CursorGaze {
  private last = { x: NaN, y: NaN, at: -Infinity };
  private followSince = 0; private breakUntil = 0; private release: ReturnType<typeof setTimeout> | null = null;
  private now: () => number;
  constructor(private d: CursorGazeDeps) { this.now = d.now ?? (() => performance.now()); }
  /** feed one pointer movement; returns true when the eyes were pointed at it */
  move(px: number, py: number, box: { left: number; top: number; width: number; height: number }, pointerType = 'mouse'): boolean {
    if (pointerType === 'touch') return false;
    const t = this.now(); const E = this.d.engine; const mode = E.getGaze().mode;
    const eligible = this.d.allowed() && this.d.state() === 'idle' && (mode === 'idle' || mode === 'user' || mode === 'cursor');   // not while typing (chat) or thinking
    if (!eligible) { this.followSince = 0; return false; }
    if (t < this.breakUntil || t - this.last.at < CURSOR_LIMITS.throttleMs) return false;
    if (Number.isFinite(this.last.x) && Math.hypot(px - this.last.x, py - this.last.y) < CURSOR_LIMITS.minMovePx) return false;
    this.last = { x: px, y: py, at: t };
    if (!this.followSince) this.followSince = t;
    // long enough: look away for a moment instead of staring
    if (t - this.followSince > CURSOR_LIMITS.followMs) { this.followSince = 0; this.breakUntil = t + CURSOR_LIMITS.breakMs; this.letGo(); return false; }
    const [x, y] = cursorTarget(px, py, box);
    E.lookAt(x, y, 'cursor');
    if (this.release) clearTimeout(this.release);
    this.release = setTimeout(() => { this.release = null; this.followSince = 0; this.letGo(); }, CURSOR_LIMITS.releaseMs);
    return true;
  }
  /** back to the engine's own idle gaze — only if the eyes are still ours */
  private letGo() { if (this.d.engine.getGaze().mode === 'cursor') this.d.engine.lookAt(null); }
  dispose() { if (this.release) clearTimeout(this.release); this.release = null; this.letGo(); }
}

/** Wires a CursorGaze to the window's pointer movements, measured against `el` (the robot's box). Returns the cleanup. */
export function attachCursorGaze(el: HTMLElement, d: CursorGazeDeps): () => void {
  const g = new CursorGaze(d);
  const onMove = (e: PointerEvent) => { const target = el.querySelector('.stage-box, .stage') ?? el; g.move(e.clientX, e.clientY, target.getBoundingClientRect(), e.pointerType); };
  window.addEventListener('pointermove', onMove, { passive: true });
  return () => { window.removeEventListener('pointermove', onMove); g.dispose(); };
}
