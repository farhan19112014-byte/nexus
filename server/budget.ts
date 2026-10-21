/**
 * Daily budgets for a public NEXUS server: they protect the owner's Gemini / ElevenLabs quota from being used up by
 * one visitor or by bots. Counted in memory per UTC day (a restart starts a fresh count — acceptable for a prototype;
 * the providers' own quotas still apply). 0 means "no limit".
 */
export interface BudgetLimits { chatsPerDay: number; chatsPerIpPerDay: number; speechCharsPerDay: number }

export class DailyBudget {
  private day = ''; private chats = 0; private speech = 0; private perIp = new Map<string, number>();
  constructor(private limits: BudgetLimits, private now = () => new Date()) {}
  private roll() { const d = this.now().toISOString().slice(0, 10); if (d !== this.day) { this.day = d; this.chats = 0; this.speech = 0; this.perIp.clear(); } }
  /** Reserve one chat for this visitor; returns a reason when the day's budget is used up. */
  takeChat(ip: string): { ok: true } | { ok: false; reason: string } {
    this.roll(); const L = this.limits; const mine = this.perIp.get(ip) ?? 0;
    if (L.chatsPerDay && this.chats >= L.chatsPerDay) return { ok: false, reason: 'NEXUS has answered as many messages as this public server allows today (to protect its free AI quota). Please try again tomorrow — or run NEXUS on your own computer.' };
    if (L.chatsPerIpPerDay && mine >= L.chatsPerIpPerDay) return { ok: false, reason: `You have reached today's limit of ${L.chatsPerIpPerDay} messages on this public server. Please come back tomorrow — or run NEXUS on your own computer for unlimited use.` };
    this.chats++; this.perIp.set(ip, mine + 1); if (this.perIp.size > 20000) this.perIp.clear();
    return { ok: true };
  }
  /** Reserve spoken characters; returns a reason when the day's voice budget is used up. */
  takeSpeech(chars: number): { ok: true } | { ok: false; reason: string } {
    this.roll(); const L = this.limits.speechCharsPerDay;
    if (L && this.speech + chars > L) return { ok: false, reason: "The voice has used today's budget on this public server — replies are shown as text until tomorrow." };
    this.speech += chars; return { ok: true };
  }
  snapshot() { this.roll(); return { day: this.day, chats: this.chats, speechChars: this.speech, limits: this.limits }; }
}
