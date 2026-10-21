/**
 * One clean, typed event interface between the AI/voice controller and the robot renderer (or anything else that
 * wants to react: captions, plugins, a future 3D renderer). Events are derived from the single companion state
 * machine, so they can never disagree with what the robot is actually doing.
 *   onListeningStart · onProcessingStart · onResponseReceived · onSpeechStart · onSpeechEnd · onSpeechInterrupted · onError
 */
import type { CompanionState, StateMachine } from './stateMachine';

export type RobotEventName = 'onListeningStart' | 'onProcessingStart' | 'onResponseReceived' | 'onSpeechStart' | 'onSpeechEnd' | 'onSpeechInterrupted' | 'onError';
export interface RobotEvent { name: RobotEventName; from: CompanionState; to: CompanionState; at: number }
type Listener = (e: RobotEvent) => void;

/** Which events a state change means (pure — unit tested). */
export function eventsFor(from: CompanionState, to: CompanionState): RobotEventName[] {
  const out: RobotEventName[] = [];
  if (to === 'listening') out.push('onListeningStart');
  if (to === 'processing') out.push('onProcessingStart');
  if (from === 'processing' && (to === 'responding' || to === 'speaking' || to === 'acting')) out.push('onResponseReceived');
  if (to === 'speaking' && from !== 'paused') out.push('onSpeechStart');
  if ((from === 'speaking' || from === 'paused') && to !== 'paused' && to !== 'speaking') out.push(to === 'interrupted' || to === 'listening' ? 'onSpeechInterrupted' : 'onSpeechEnd');
  if (to === 'error') out.push('onError');
  return out;
}

export class RobotEvents {
  private ls = new Map<RobotEventName | '*', Set<Listener>>();
  readonly log: RobotEvent[] = [];
  attach(sm: StateMachine) { return sm.on((to, from) => { for (const name of eventsFor(from, to)) this.emit({ name, from, to, at: Date.now() }); }); }
  on(name: RobotEventName | '*', f: Listener) { const s = this.ls.get(name) ?? new Set(); s.add(f); this.ls.set(name, s); return () => { s.delete(f); }; }
  private emit(e: RobotEvent) {
    this.log.push(e); if (this.log.length > 50) this.log.shift();
    for (const f of [...(this.ls.get(e.name) ?? []), ...(this.ls.get('*') ?? [])]) { try { f(e); } catch { /* a listener must never break the robot */ } }
  }
}
