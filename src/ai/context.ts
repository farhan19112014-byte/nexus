/**
 * Assets 44/51/86 — session conversation store and context-window builder.
 * Failed, cancelled and system messages are never sent back to the model.
 */
import type { BrainResponse, ChatMessage, ResponseMeta, Source } from '../../shared/schema';
import type { LearnOutcome } from '../skills/learning';

export type MsgStatus = 'sending' | 'streaming' | 'complete' | 'failed' | 'cancelled';
export interface UIMessage {
  id: string; role: 'user' | 'assistant' | 'system'; text: string; at: number; status: MsgStatus;
  error?: { message: string; code: string; retryable: boolean };
  sources?: Source[]; meta?: ResponseMeta; response?: BrainResponse; learn?: LearnOutcome; notes?: string[];
  stage?: 'researching' | 'thinking' | 'streaming';
  /** for the training/learning disclosure (Asset 80) */
  changes?: { scope: 'conversation' | 'memory' | 'skill_registry' | 'preference' | 'retrieval'; text: string }[];
  replyTo?: string;
  /** set on the on-device reply that created a reminder (so editing that turn cancels it) */
  reminderId?: string;
}

export const SESSION_LIMIT = 200;
let seq = 0;
export const msgId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function buildContext(messages: UIMessage[], maxMessages: number, maxChars = 20000): ChatMessage[] {
  const usable = messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && (m.status === 'complete' || (m.role === 'user' && m.status !== 'cancelled')) && m.text.trim());
  // drop user turns whose assistant reply failed/cancelled (except the newest pending user turn)
  const out: ChatMessage[] = [];
  let chars = 0;
  for (let i = usable.length - 1; i >= 0 && out.length < maxMessages; i--) {
    const m = usable[i];
    const c = m.text.slice(0, 5000);
    if (chars + c.length > maxChars && out.length) break;
    out.unshift({ role: m.role as 'user' | 'assistant', content: c }); chars += c.length;
  }
  while (out.length && out[0].role !== 'user') out.shift();
  const merged: ChatMessage[] = [];
  for (const m of out) { const p = merged.at(-1); if (p && p.role === m.role) p.content = `${p.content}\n${m.content}`.slice(-5800); else merged.push({ ...m }); }
  return merged;
}
