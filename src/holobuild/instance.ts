/** The app's HOLOBUILD controller, wired to the shared NEXUS singletons (robot, voice, conversation, server). */
import { api, companion, kv, learner } from '../core/runtime';
import { HoloController, type HoloExperience } from './controller';
import { HoloStore } from './store';

/** listeners for HOLOBUILD events the learning engine records (real events only) */
export const holoExperience = new Set<(e: HoloExperience) => void>();

export const holo = new HoloController({
  store: new HoloStore(kv),
  task: (path, body, signal) => api.task(path, body, signal),
  aiAvailable: () => { const c = companion.getSnapshot().caps; return c ? c.isLLM : null; },
  activity: (kind, label) => companion.beginActivity(kind, label),
  announce: (text) => companion.announce(text),
  ask: (text, workspace) => { void companion.send(text, workspace ? { context: { workspace } } : {}); },
  experience: (e) => {
    holoExperience.forEach((f) => f(e));
    void learner.record(e.type === 'edit-corrected'
      ? { type: 'correction', summary: `HOLOBUILD edit corrected: “${e.text}” (${e.detail ?? ''})`, topic: 'holobuild edit', source: 'holobuild', ref: '' }
      : { type: 'holo-failure', summary: `HOLOBUILD ${e.type.replace('-', ' ')}: “${e.text}”${e.detail ? ` — ${e.detail}` : ''}`, topic: e.type.startsWith('build') ? `build ${e.text}` : 'holobuild edit', source: 'holobuild', ref: '' });
  },
});
(globalThis as unknown as { nexus?: Record<string, unknown> }).nexus!.holo = holo;
