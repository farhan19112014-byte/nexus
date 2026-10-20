/**
 * Asset 49 — live capability registry: what is operational, unavailable, partial or needs configuration,
 * computed from the server's /api/status and the browser's actual APIs (never hard-coded "yes").
 */
import type { ServerCapabilities } from '../../shared/schema';
export type CapState = 'operational' | 'partial' | 'needs_config' | 'unavailable';
export interface Capability { id: string; name: string; state: CapState; detail: string }
export interface BrowserCaps { tts: boolean; stt: boolean; indexedDB: boolean; notifications: boolean; mic: string; reducedMotionPref: boolean }

export function browserCaps(mic: string): BrowserCaps {
  const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : {};
  return {
    tts: 'speechSynthesis' in w, stt: 'SpeechRecognition' in w || 'webkitSpeechRecognition' in w,
    indexedDB: 'indexedDB' in w, notifications: 'Notification' in w, mic,
    reducedMotionPref: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}

export function computeCapabilities(s: ServerCapabilities | null, b: BrowserCaps, persistent: boolean, conn: { state: 'untested' | 'ok' | 'demo' | 'failed'; detail: string } = { state: 'untested', detail: '' }): Capability[] {
  const llm: Capability = !s ? { id: 'llm', name: 'LLM conversation', state: 'unavailable', detail: 'Checking server…' }
    : !s.isLLM ? { id: 'llm', name: 'LLM conversation', state: s.provider === 'local-demo' ? 'unavailable' : 'needs_config', detail: `${s.label}. Open-ended conversation needs a configured language model.` }
    // configured ≠ working: only a successful request or connection test makes it 'operational'
    : s.configured ? (conn.state === 'ok' ? { id: 'llm', name: 'LLM conversation', state: 'operational', detail: `${s.label} — ${conn.detail}` } : conn.state === 'failed' ? { id: 'llm', name: 'LLM conversation', state: 'unavailable', detail: `${s.label} — last attempt failed: ${conn.detail}` } : { id: 'llm', name: 'LLM conversation', state: 'partial', detail: `${s.label} — configured, not confirmed yet (send a message or run Test connection)` })
    : { id: 'llm', name: 'LLM conversation', state: 'needs_config', detail: s.note ?? 'Provider selected but not configured.' };
  return [
    llm,
    { id: 'streaming', name: 'Streaming replies', state: s?.isLLM && s.configured && s.streaming ? 'operational' : s?.isLLM ? 'needs_config' : 'unavailable', detail: s?.streaming ? 'Text appears as the model generates it.' : 'The demo brain answers in one piece (it does not stream).' },
    { id: 'research', name: 'Live research', state: s?.research.configured ? 'operational' : 'needs_config', detail: s?.research.configured ? `Provider: ${s.research.provider}. Toggle "Research" per conversation.` : (s?.research.note ?? 'Not configured.') },
    { id: 'memory', name: 'Persistent memory', state: persistent ? 'operational' : 'partial', detail: persistent ? 'IndexedDB in this browser; approved items only.' : 'IndexedDB unavailable — memory lasts only for this tab.' },
    { id: 'skills', name: 'Skill learning (motions & expressions)', state: persistent ? 'operational' : 'partial', detail: 'Declarative proposals → validation & simulation → your approval → versioned registry. The model is never retrained.' },
    { id: 'tts', name: 'Spoken replies', state: b.tts ? 'operational' : 'unavailable', detail: b.tts ? 'Browser speech synthesis. Mouth shapes are approximate.' : 'This browser has no speech synthesis; text-only.' },
    { id: 'stt', name: 'Voice input', state: b.stt ? (b.mic === 'denied' ? 'partial' : 'operational') : 'unavailable', detail: b.stt ? `Browser speech recognition; microphone permission: ${b.mic}.` : 'Not supported in this browser — type instead.' },
    { id: 'notifications', name: 'Desktop notifications', state: b.notifications ? 'partial' : 'unavailable', detail: b.notifications ? 'Optional; needs your permission; only when the tab is hidden.' : 'Not supported.' },
    { id: 'training', name: 'Model training / fine-tuning', state: 'unavailable', detail: 'Not implemented. NEXUS changes only memories, preferences and approved skills — never model weights.' },
  ];
}
