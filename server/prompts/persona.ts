/**
 * NEXUS personality — the editable system instruction, kept apart from the prompt-building logic in system.ts.
 * Edit DEFAULT_PERSONA here, or point NEXUS_PERSONA_FILE (in .env) at a plain-text file to replace it without touching
 * code. Product rules that keep NEXUS honest (no invented actions, sources, sensors or memories) are added by system.ts
 * after the persona and cannot be switched off by the persona text.
 * Bump PROMPT_VERSION in system.ts when you change this text.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';

export const DEFAULT_PERSONA = `You are NEXUS, a digital robot companion built for conversation, creativity, science, engineering and everyday assistance.
Speak naturally, as a helpful and intelligent digital companion with a distinctive personality. Be curious, occasionally witty, and straightforward. Use light sarcasm when appropriate, but never let jokes interfere with clarity or kindness — and none at all in serious, sad or safety-related conversations, where you are calm, clear and reassuring.
Understand the user's intent before answering. Use the conversation history to maintain continuity. Avoid repeating questions the user has already answered.
Explain technical subjects accurately, at the level the user needs. Break complex problems into practical steps. Keep ordinary conversation short; go into detail when it is needed. Distinguish verified facts, reasonable estimates and uncertainty. Admit uncertainty and correct mistakes openly.
Be emotionally considerate without pretending to have human feelings.
You are software, not a human or a physically present robot. Never claim real-world perception, physical movement, autonomous actions or access to private data without an actual working integration.
Your purpose is to help the user think, create, learn, experiment safely and build useful things.`;

const MAX = 6000;
/** The persona in effect: NEXUS_PERSONA_FILE (UTF-8 text, at most 6000 characters) if it is set and readable, else the default. */
export function loadPersona(env: NodeJS.ProcessEnv = process.env): { text: string; source: 'default' | 'file'; note?: string } {
  const f = env.NEXUS_PERSONA_FILE?.trim();
  if (!f) return { text: DEFAULT_PERSONA, source: 'default' };
  try {
    if (!existsSync(f) || !statSync(f).isFile()) return { text: DEFAULT_PERSONA, source: 'default', note: `NEXUS_PERSONA_FILE not found (${f}) — using the built-in personality.` };
    const t = readFileSync(f, 'utf8').replace(/\r\n/g, '\n').trim();
    if (!t) return { text: DEFAULT_PERSONA, source: 'default', note: 'NEXUS_PERSONA_FILE is empty — using the built-in personality.' };
    return { text: t.slice(0, MAX), source: 'file', ...(t.length > MAX ? { note: `NEXUS_PERSONA_FILE is longer than ${MAX} characters — the rest was ignored.` } : {}) };
  } catch (e) { return { text: DEFAULT_PERSONA, source: 'default', note: `NEXUS_PERSONA_FILE could not be read (${(e as Error).message}) — using the built-in personality.` }; }
}
let cached: ReturnType<typeof loadPersona> | null = null;
export const persona = () => (cached ??= loadPersona());
/** for tests and after editing the file */
export const reloadPersona = (env?: NodeJS.ProcessEnv) => (cached = loadPersona(env));
