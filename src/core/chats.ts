/**
 * Saved chats (local only): the current conversation survives reloads, and earlier chats can be listed,
 * searched, reopened, exported or deleted. Stored in this browser's IndexedDB ("chats" store); validated on load.
 * Nothing here is sent anywhere — only the *current* chat's recent turns go to the model, as before.
 */
import { z } from 'zod';
import type { KV } from '../storage/db';
import type { UIMessage } from '../ai/context';

export const CHAT_LIMITS = { chats: 200, messagesPerChat: 200, textChars: 20000 };

const StoredMessageSchema = z.object({
  id: z.string().max(64), role: z.enum(['user', 'assistant', 'system']), text: z.string().max(CHAT_LIMITS.textChars), at: z.number(),
  status: z.enum(['sending', 'streaming', 'complete', 'failed', 'cancelled']),
  replyTo: z.string().max(64).optional(),
  reminderId: z.string().max(64).optional(),
  error: z.object({ message: z.string().max(500), code: z.string().max(40), retryable: z.boolean() }).optional(),
  meta: z.object({ provider: z.string().max(60), model: z.string().max(120).nullable(), isLLM: z.boolean(), latencyMs: z.number(), streamed: z.boolean() }).passthrough().optional(),
  sources: z.array(z.object({ id: z.number(), title: z.string(), url: z.string(), snippet: z.string(), provider: z.string(), retrievedAt: z.string() }).passthrough()).max(10).optional(),
}).strip();
export type StoredMessage = z.infer<typeof StoredMessageSchema>;

export const SavedChatSchema = z.object({
  id: z.string().max(64), title: z.string().max(120), createdAt: z.number(), updatedAt: z.number(),
  messages: z.array(StoredMessageSchema).max(CHAT_LIMITS.messagesPerChat),
});
export type SavedChat = z.infer<typeof SavedChatSchema>;
export interface ChatHit { chat: SavedChat; snippet: string; matches: number }

const newId = () => `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** A short title from the first user message. */
export function titleFor(messages: { role: string; text: string }[]): string {
  const first = messages.find((m) => m.role === 'user')?.text.trim().replace(/\s+/g, ' ') ?? 'New chat';
  return first.length > 60 ? `${first.slice(0, 57)}…` : first || 'New chat';
}

/** Converts live messages to their storable form (in-flight messages are saved as cancelled, never as complete). */
export function toStored(messages: UIMessage[]): StoredMessage[] {
  return messages.slice(-CHAT_LIMITS.messagesPerChat).map((m) => StoredMessageSchema.parse({
    reminderId: m.reminderId, id: m.id, role: m.role, text: m.text.slice(0, CHAT_LIMITS.textChars), at: m.at, replyTo: m.replyTo,
    status: m.status === 'sending' || m.status === 'streaming' ? 'cancelled' : m.status,
    error: m.error ? { ...m.error, message: m.error.message.slice(0, 500) } : undefined,
    meta: m.meta ? { provider: m.meta.provider, model: m.meta.model, isLLM: m.meta.isLLM, latencyMs: m.meta.latencyMs, streamed: m.meta.streamed } : undefined,
    sources: m.sources?.slice(0, 10),
  }));
}

export class ChatStore {
  chats: SavedChat[] = [];
  currentId: string = newId();
  ready: Promise<void>;
  loadErrors: string[] = [];
  private listeners = new Set<() => void>();
  version = 0;
  private deleted = new Set<string>();
  private savedThisSession = false;
  constructor(private kv: KV) { this.ready = this.load(); }
  subscribe(f: () => void) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
  private changed() { this.version++; this.listeners.forEach((f) => f()); }

  private async load() {
    try {
      for (const row of await this.kv.all<unknown>('chats')) {
        const p = SavedChatSchema.safeParse(row);
        if (p.success) this.chats.push(p.data); else this.loadErrors.push('A corrupted saved chat was skipped.');
      }
      this.chats.sort((a, b) => b.updatedAt - a.updatedAt);
      const cur = await this.kv.get<string>('kv', 'currentChat');
      // don't switch chats if this session already saved a new one (it would be overwritten by later saves)
      if (!this.savedThisSession && typeof cur === 'string' && this.chats.some((c) => c.id === cur)) this.currentId = cur;
    } catch { this.loadErrors.push('Saved chats could not be loaded.'); }
    this.changed();
  }

  get current(): SavedChat | undefined { return this.chats.find((c) => c.id === this.currentId); }

  /** Saves the live conversation under the current chat id. Chats without a user message are not saved. */
  async saveCurrent(messages: UIMessage[]): Promise<boolean> {
    if (!messages.some((m) => m.role === 'user')) return false;
    if (this.deleted.has(this.currentId)) return false;
    this.savedThisSession = true;
    const stored = toStored(messages);
    const prev = this.current;
    const chat: SavedChat = { id: this.currentId, title: prev?.title ?? titleFor(stored), createdAt: prev?.createdAt ?? stored[0].at, updatedAt: Date.now(), messages: stored };
    await this.kv.put('chats', chat);
    if (this.deleted.has(chat.id)) { await this.kv.del('chats', chat.id).catch(() => {}); return false; } // deleted while this save was in flight
    await this.kv.put('kv', this.currentId, 'currentChat');
    this.chats = [chat, ...this.chats.filter((c) => c.id !== chat.id)];
    if (this.chats.length > CHAT_LIMITS.chats) {
      for (const old of this.chats.slice(CHAT_LIMITS.chats)) await this.kv.del('chats', old.id).catch(() => {});
      this.chats = this.chats.slice(0, CHAT_LIMITS.chats);
    }
    this.changed();
    return true;
  }
  /** Starts a fresh chat; the previous one stays in the list. */
  async startNew() { this.currentId = newId(); await this.kv.put('kv', this.currentId, 'currentChat').catch(() => {}); this.changed(); return this.currentId; }
  async open(id: string): Promise<SavedChat | null> {
    const c = this.chats.find((x) => x.id === id); if (!c) return null;
    this.currentId = id; await this.kv.put('kv', id, 'currentChat').catch(() => {}); this.changed(); return c;
  }
  async rename(id: string, title: string) {
    const c = this.chats.find((x) => x.id === id); const t = title.trim().replace(/\s+/g, ' ').slice(0, 120); if (!c || !t) return false;
    const next = { ...c, title: t }; await this.kv.put('chats', next); this.chats = this.chats.map((x) => (x.id === id ? next : x)); this.changed(); return true;
  }
  async remove(id: string) {
    this.deleted.add(id);
    await this.kv.del('chats', id);
    this.chats = this.chats.filter((c) => c.id !== id);
    if (id === this.currentId) this.currentId = newId();
    this.changed();
  }
  async removeAll() { for (const c of this.chats) await this.kv.del('chats', c.id); this.chats = []; this.currentId = newId(); this.changed(); }

  /** Case-insensitive search over titles and message text; every word must appear somewhere in the chat. */
  search(q: string): ChatHit[] {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return this.chats.map((chat) => ({ chat, snippet: chat.messages.find((m) => m.role === 'assistant')?.text.slice(0, 100) ?? '', matches: 0 }));
    const hits: ChatHit[] = [];
    for (const chat of this.chats) {
      const hay = `${chat.title}\n${chat.messages.map((m) => m.text).join('\n')}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
      let matches = 0; for (const w of words) matches += hay.split(w).length - 1;
      const m = chat.messages.find((x) => x.text.toLowerCase().includes(words[0])) ?? chat.messages[0];
      const at = Math.max(0, m.text.toLowerCase().indexOf(words[0]) - 40);
      hits.push({ chat, snippet: `${at ? '…' : ''}${m.text.slice(at, at + 120).replace(/\s+/g, ' ')}${m.text.length > at + 120 ? '…' : ''}`, matches });
    }
    return hits.sort((a, b) => b.matches - a.matches || b.chat.updatedAt - a.chat.updatedAt);
  }

  /** Markdown export of one chat (for saving to a file). */
  toMarkdown(chat: SavedChat, robotName: string): string {
    const lines = [`# ${chat.title}`, '', `_${new Date(chat.createdAt).toLocaleString()} · exported from NEXUS_`, ''];
    for (const m of chat.messages) {
      if (m.role === 'system') { lines.push(`> ${m.text}`, ''); continue; }
      lines.push(`**${m.role === 'user' ? 'You' : robotName}** · ${new Date(m.at).toLocaleTimeString()}${m.status !== 'complete' ? ` · ${m.status}` : ''}`, '', m.text, '');
    }
    return lines.join('\n');
  }
}
