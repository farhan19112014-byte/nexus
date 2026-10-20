/**
 * Asset 40 — typed companion state machine with legal transitions and precedence.
 * Precedence decides which state drives the face/indicator when several apply.
 */
export type CompanionState = 'idle' | 'greeting' | 'listening' | 'processing' | 'responding' | 'speaking' | 'paused' | 'acting' | 'interrupted' | 'error' | 'recovering' | 'resting';
export const TRANSITIONS: Record<CompanionState, CompanionState[]> = {
  idle: ['greeting', 'listening', 'processing', 'acting', 'error', 'resting'],
  greeting: ['idle', 'listening', 'processing', 'interrupted', 'error'],
  listening: ['processing', 'idle', 'error', 'interrupted'],
  processing: ['responding', 'speaking', 'acting', 'idle', 'error', 'interrupted', 'listening'],
  responding: ['speaking', 'acting', 'idle', 'error', 'interrupted', 'listening'],
  speaking: ['acting', 'idle', 'error', 'interrupted', 'listening', 'responding', 'paused'],
  paused: ['speaking', 'idle', 'interrupted', 'listening', 'processing', 'error'],
  acting: ['idle', 'speaking', 'processing', 'listening', 'error', 'interrupted'],
  interrupted: ['idle', 'listening', 'processing'],
  error: ['recovering', 'idle', 'listening', 'processing', 'acting'],
  recovering: ['idle', 'listening', 'processing', 'acting', 'error'],
  resting: ['idle', 'greeting', 'listening', 'processing', 'acting'],
};
export const PRECEDENCE: Record<CompanionState, number> = { recovering: 5, paused: 2, error: 6, listening: 5, interrupted: 4, processing: 3, speaking: 2, responding: 2, greeting: 1, acting: 1, resting: 0, idle: 0 };

export class StateMachine {
  state: CompanionState = 'idle';
  history: { from: CompanionState; to: CompanionState; at: number }[] = [];
  rejected = 0;
  private listeners = new Set<(s: CompanionState, prev: CompanionState) => void>();
  can(to: CompanionState) { return to === this.state || TRANSITIONS[this.state].includes(to); }
  go(to: CompanionState): boolean {
    if (to === this.state) return true;
    if (!TRANSITIONS[this.state].includes(to)) { this.rejected++; return false; }
    const prev = this.state; this.state = to;
    this.history.push({ from: prev, to, at: Date.now() }); if (this.history.length > 80) this.history.shift();
    this.listeners.forEach((f) => f(to, prev));
    return true;
  }
  /** Force a recovery to idle from any state (used by reset). */
  reset() { const prev = this.state; this.state = 'idle'; if (prev !== 'idle') this.listeners.forEach((f) => f('idle', prev)); }
  on(f: (s: CompanionState, prev: CompanionState) => void) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
}
