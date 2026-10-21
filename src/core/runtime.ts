/** App singletons: one engine, one expression controller, one loop, one companion. */
import { AnimationEngine } from '../animation/engine';
import { ExpressionController } from '../expressions/expressionController';
import { BUILTIN_EXPRESSIONS } from '../expressions/presets';
import { CharacterRuntime } from './characterRuntime';
import { openStore } from '../storage/db';
import { SkillRegistry } from '../skills/registry';
import { LearningSystem } from '../skills/learning';
import { MemoryStore } from '../memory/store';
import { ApiClient } from '../ai/apiClient';
import { Companion } from './companion';
import { ChatStore } from './chats';
import { ReminderStore } from './reminders';

const kv = openStore();
export const engine = new AnimationEngine();
export const expressions = new ExpressionController(BUILTIN_EXPRESSIONS);
export const runtime = new CharacterRuntime(engine, expressions);
export const registry = new SkillRegistry(kv);
export const memory = new MemoryStore(kv);
export const learning = new LearningSystem(registry, kv);
export const api = new ApiClient();
export const chats = new ChatStore(kv);
export const reminders = new ReminderStore(kv);
export const companion = new Companion({ runtime, registry, memory, learning, api, persistent: kv.persistent, chats, reminders });
api.onWaking = () => companion.notifications.push('info', 'Waking up the NEXUS server — free hosting sleeps when nobody uses it, so this first connection can take up to a minute.', { react: false });
learning.refinementPolicy = () => memory.settings.refinementPolicy;
runtime.onFrameError = (e) => companion.diagnostics.log({ type: 'error', code: 'frame', detail: String(e) });

// debug/test handle (no secrets live in the browser)
(globalThis as unknown as Record<string, unknown>).nexus = {
  engine, expressions, runtime, registry, memory, learning, companion, chats, reminders,
  step(seconds: number, dt = 1 / 30) { for (let t = 0; t < seconds; t += dt) runtime.step(dt); },
};
