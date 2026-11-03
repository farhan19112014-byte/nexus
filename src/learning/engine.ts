/**
 * NEXUS learning engine (browser side). Keeps experiences, verified knowledge, research reports, reflections, workflow
 * skills and an audit log in IndexedDB, and runs research / reflection / skills through the NEXUS server.
 *
 * Honesty rules:
 *  - nothing here retrains or changes the AI model; learning = data NEXUS keeps and shows you;
 *  - only real events are recorded (each with its time and source); metrics are counted from stored records;
 *  - background research happens only when you turned it on, while NEXUS is open, within the daily limit — and every
 *    run is logged; nothing claims research happened when it did not;
 *  - a new skill version becomes active only after its tests pass AND you approve it; every change is in the audit log.
 */
import {
  AuditSchema, ExperienceSchema, KnowledgeSchema, LEARN_LIMITS, LearningSettingsSchema, ReflectionSchema, ResearchReportSchema, SkillBodySchema, WorkflowSkillSchema,
  evaluateTest, retrieve, similarity, terms,
  type Audit, type Experience, type Knowledge, type LearningSettings, type Reflection, type ResearchReport, type SkillBody, type SkillVersion, type TestResult, type Verification, type WorkflowSkill,
} from '../../shared/learning';
import type { KV } from '../storage/db';
import { looksSensitive, redact } from '../security/validation';

export interface LearnDeps {
  kv: KV;
  task: (path: string, body: unknown, signal?: AbortSignal) => Promise<unknown>;
  aiAvailable: () => boolean | null;
  activity?: (kind: 'researching' | 'reflecting', label: string) => (o: 'done' | 'failed' | 'cancelled') => void;
  /** true while the user is not mid-conversation (background tasks wait otherwise) */
  idle?: () => boolean;
  now?: () => number;
}
export type Report = ResearchReport | Reflection;
export interface GapItem { question: string; at: number; trigger: 'gap' | 'user' | 'recheck'; approved: boolean; knowledgeId?: string }
const DAY = 86400000;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const today = (t: number) => new Date(t).toISOString().slice(0, 10);
const normQ = (s: string) => terms(s).sort().join(' ');

export class LearningEngine {
  settings: LearningSettings = LearningSettingsSchema.parse({});
  knowledge: Knowledge[] = []; experiences: Experience[] = []; reports: Report[] = []; skills: WorkflowSkill[] = []; audit: Audit[] = [];
  queue: GapItem[] = [];
  /** research runs today (real count, persisted) */
  daily = { day: '', n: 0 };
  /** what the background learner is doing / did last — shown in the dashboard */
  background = { running: false, lastRunAt: null as number | null, lastResult: '' };
  busy: string | null = null;
  lastError: string | null = null;
  version = 0;
  readonly ready: Promise<void>;
  private listeners = new Set<() => void>();
  private questions = new Map<string, { n: number; at: number; topic: string }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private now: () => number;

  constructor(private d: LearnDeps) { this.now = d.now ?? Date.now; this.ready = this.load(); }
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  private changed() { this.version++; this.listeners.forEach((f) => f()); }

  private async load() {
    const all = async <T>(store: 'experiences' | 'knowledge' | 'research' | 'wskills' | 'audit', parse: (x: unknown) => { success: boolean; data?: T }) => {
      try { return (await this.d.kv.all<unknown>(store)).map(parse).filter((r) => r.success).map((r) => r.data as T); } catch { return []; }
    };
    const s = LearningSettingsSchema.safeParse(await this.d.kv.get('kv', 'learn.settings').catch(() => undefined)); if (s.success) this.settings = s.data;
    const cutoff = this.now() - LEARN_LIMITS.retentionDays * DAY;
    this.experiences = (await all('experiences', (x) => ExperienceSchema.safeParse(x))).filter((e) => e.at >= cutoff).sort((a, b) => b.at - a.at);
    this.knowledge = (await all('knowledge', (x) => KnowledgeSchema.safeParse(x))).sort((a, b) => b.updatedAt - a.updatedAt);
    this.reports = (await all<Report>('research', (x) => ((x as { kind?: string })?.kind === 'reflection' ? ReflectionSchema : ResearchReportSchema).safeParse(x))).sort((a, b) => b.at - a.at);
    this.skills = (await all('wskills', (x) => WorkflowSkillSchema.safeParse(x))).sort((a, b) => b.updatedAt - a.updatedAt);
    this.audit = (await all('audit', (x) => AuditSchema.safeParse(x))).sort((a, b) => b.at - a.at).slice(0, 300);
    const q = await this.d.kv.get<GapItem[]>('kv', 'learn.queue').catch(() => undefined); if (Array.isArray(q)) this.queue = q.filter((x) => typeof x?.question === 'string').slice(0, 30);
    const dd = await this.d.kv.get<{ day: string; n: number }>('kv', 'learn.daily').catch(() => undefined); if (dd && dd.day === today(this.now())) this.daily = dd;
    const qs = await this.d.kv.get<[string, { n: number; at: number; topic: string }][]>('kv', 'learn.questions').catch(() => undefined); if (Array.isArray(qs)) this.questions = new Map(qs.slice(-200));
    this.armBackground(); this.changed();
  }
  private async log(actor: Audit['actor'], action: string, target = '', detail = '') {
    const a = AuditSchema.parse({ at: this.now(), actor, action, target: target.slice(0, 120), detail: detail.slice(0, 400) });
    this.audit = [a, ...this.audit].slice(0, 300);
    try { await this.d.kv.put('audit', a); } catch { /* the in-memory log still shows it */ }
  }

  /* ---------------- settings & permissions ---------------- */
  async updateSettings(p: Partial<LearningSettings>) {
    const next = LearningSettingsSchema.parse({ ...this.settings, ...p });
    const diff = Object.keys(p).filter((k) => JSON.stringify((this.settings as Record<string, unknown>)[k]) !== JSON.stringify((next as Record<string, unknown>)[k]));
    this.settings = next; await this.d.kv.put('kv', next, 'learn.settings');
    if (diff.length) await this.log('user', 'settings', diff.join(', '), diff.map((k) => `${k} = ${JSON.stringify((next as Record<string, unknown>)[k])}`).join('; '));
    this.armBackground(); this.changed();
  }

  /* ---------------- experiences ---------------- */
  /** Records one real event. Sensitive text is never stored; summaries are short and redacted. */
  async record(e: Omit<Experience, 'id' | 'at' | 'processed'>): Promise<Experience | null> {
    if (!this.settings.collect) return null;
    const summary = redact(e.summary).replace(/\s+/g, ' ').trim().slice(0, LEARN_LIMITS.summary);
    if (!summary || looksSensitive(e.summary)) return null;
    const x = ExperienceSchema.parse({ ...e, summary, topic: redact(e.topic ?? '').slice(0, 120), id: uid('xp'), at: this.now(), processed: false });
    this.experiences = [x, ...this.experiences].slice(0, LEARN_LIMITS.experiences);
    try { await this.d.kv.put('experiences', x); } catch { /* shown in memory */ }
    this.changed(); return x;
  }
  async deleteExperience(id: string) { this.experiences = this.experiences.filter((x) => x.id !== id); await this.d.kv.del('experiences', id).catch(() => {}); await this.log('user', 'delete experience', id); this.changed(); }
  async clear(kind: 'experiences' | 'knowledge' | 'reports' | 'all') {
    if (kind === 'experiences' || kind === 'all') { this.experiences = []; await this.d.kv.clear('experiences').catch(() => {}); }
    if (kind === 'knowledge' || kind === 'all') { this.knowledge = []; await this.d.kv.clear('knowledge').catch(() => {}); }
    if (kind === 'reports' || kind === 'all') { this.reports = []; await this.d.kv.clear('research').catch(() => {}); }
    if (kind === 'all') { this.queue = []; await this.d.kv.put('kv', [], 'learn.queue').catch(() => {}); this.questions.clear(); await this.d.kv.put('kv', [], 'learn.questions').catch(() => {}); }
    await this.log('user', `clear ${kind}`); this.changed();
  }
  /** feedback buttons on a reply */
  feedback(msgId: string, helpful: boolean, question: string) {
    return this.record({ type: helpful ? 'feedback-positive' : 'feedback-negative', summary: `${helpful ? 'Helpful' : 'Not helpful'}: reply to “${question.slice(0, 160)}”`, topic: topicOf(question), source: 'chat', ref: msgId });
  }

  /**
   * Called after each finished exchange in the conversation. Detects (rules, not AI): corrections, repeated questions,
   * knowledge gaps (the reply said it was unsure), and failures.
   */
  async observeExchange(x: { msgId: string; user: string; reply: string; uncertainty?: string | null; failed?: string | null; previousReply?: string | null }) {
    if (!this.settings.collect || looksSensitive(x.user)) return;
    const topic = topicOf(x.user);
    if (x.failed) { await this.record({ type: 'failure', summary: `Reply failed: ${x.failed.slice(0, 200)}`, topic, source: 'chat', ref: x.msgId }); return; }
    if (x.previousReply && /^(no[,. !]|nope|that'?s (wrong|not right|incorrect)|wrong|incorrect|actually[, ]|you'?re wrong|not quite)/i.test(x.user.trim())) {
      await this.record({ type: 'correction', summary: `Corrected: “${x.user.slice(0, 220)}”`, topic, source: 'chat', ref: x.msgId });
    }
    const k = normQ(x.user);
    if (k.split(' ').length >= 2 && /\?|^(what|how|why|who|when|where|which|explain|tell me)\b/i.test(x.user.trim())) {
      const prev = this.questions.get(k); const n = (prev?.n ?? 0) + 1; this.questions.set(k, { n, at: this.now(), topic });
      if (this.questions.size > 200) this.questions.delete(this.questions.keys().next().value!);
      void this.d.kv.put('kv', [...this.questions.entries()], 'learn.questions').catch(() => {});
      if (n === 2) await this.record({ type: 'repeated-question', summary: `Asked again: “${x.user.slice(0, 200)}”`, topic, source: 'chat', ref: x.msgId });
    }
    const unsure = x.uncertainty === 'high' || /\b(i (don'?t|do not) know|i'?m not (sure|certain)|i (can'?t|cannot) (verify|confirm)|no reliable information|beyond my knowledge)\b/i.test(x.reply);
    if (unsure && x.user.length >= 8) {
      await this.record({ type: 'knowledge-gap', summary: `Unsure when asked: “${x.user.slice(0, 200)}”`, topic, source: 'chat', ref: x.msgId });
      await this.noteGap(x.user.slice(0, 300), 'gap');
    }
  }
  /** a knowledge gap: research now (auto), queue for approval (ask) or ignore (off) */
  async noteGap(question: string, trigger: GapItem['trigger']) {
    if (this.settings.gapResearch === 'off') return;
    if (this.queue.some((q) => similarity(q.question, question) > 0.7)) return;
    this.queue = [{ question, at: this.now(), trigger, approved: this.settings.gapResearch === 'auto' }, ...this.queue].slice(0, 30);
    await this.d.kv.put('kv', this.queue, 'learn.queue').catch(() => {}); this.changed();
  }
  async approveGap(i: number) { const q = this.queue[i]; if (!q) return; q.approved = true; await this.d.kv.put('kv', this.queue, 'learn.queue').catch(() => {}); await this.log('user', 'approve research', q.question); this.changed(); }
  async dismissGap(i: number) { const q = this.queue[i]; if (!q) return; this.queue.splice(i, 1); await this.d.kv.put('kv', this.queue, 'learn.queue').catch(() => {}); await this.log('user', 'dismiss research', q.question); this.changed(); }

  /* ---------------- research ---------------- */
  canResearch(): { ok: boolean; why?: string } {
    if (this.d.aiAvailable() === false) return { ok: false, why: 'No AI model is connected, so NEXUS cannot research.' };
    if (this.daily.day === today(this.now()) && this.daily.n >= this.settings.dailyResearch) return { ok: false, why: `Today's research limit (${this.settings.dailyResearch}) is reached — change it in Learning → Settings.` };
    return { ok: true };
  }
  async research(question: string, trigger: ResearchReport['trigger'] = 'user', signal?: AbortSignal): Promise<ResearchReport | null> {
    const q = question.trim().slice(0, 300); if (q.length < 3) return null;
    const can = this.canResearch(); if (!can.ok) { this.lastError = can.why!; this.changed(); return null; }
    this.busy = `Researching: ${q}`; this.lastError = null; this.changed();
    const end = this.d.activity?.('researching', q);
    try {
      const raw = await this.d.task('/api/learn/research', { question: q, trigger }, signal) as Record<string, unknown>;
      const t = today(this.now()); this.daily = { day: t, n: (this.daily.day === t ? this.daily.n : 0) + 1 }; await this.d.kv.put('kv', this.daily, 'learn.daily').catch(() => {});
      // only the report's own fields are kept (the server also sends diagnostics such as dropped / searchErrors)
      const report = ResearchReportSchema.parse({ id: uid('rs'), kind: 'research', question: q, trigger, at: this.now(), claims: raw.claims, sources: raw.sources, queries: raw.queries, provider: raw.provider, summary: raw.summary, contradictions: raw.contradictions ?? [], model: raw.model ?? '' });
      this.reports = [report, ...this.reports].slice(0, LEARN_LIMITS.reports); await this.d.kv.put('research', report);
      const added = await this.absorb(report);
      await this.log('nexus', 'research', q, `${report.sources.length} sources (${report.provider}); ${report.claims.length} claims kept; ${added.verified} verified, ${added.pending} pending, ${added.conflicting} conflicting; trigger: ${trigger}`);
      end?.('done'); this.busy = null; this.changed(); return report;
    } catch (e) {
      end?.('failed'); this.busy = null; this.lastError = `Research failed: ${(e as Error).message}`;
      await this.log('nexus', 'research failed', q, (e as Error).message); await this.record({ type: 'failure', summary: `Research failed for “${q.slice(0, 120)}”: ${(e as Error).message.slice(0, 120)}`, topic: topicOf(q), source: 'research', ref: '' });
      this.changed(); return null;
    }
  }
  /** turns a report's checked claims into knowledge (merging with similar existing items) */
  private async absorb(r: ResearchReport) {
    const count = { verified: 0, pending: 0, conflicting: 0 };
    for (const c of r.claims) {
      if (c.status === 'rejected' || c.status === 'outdated') continue;
      const sources = r.sources.filter((s) => c.sources.includes(s.id)).slice(0, 6);
      const same = this.knowledge.find((k) => similarity(k.claim, c.claim) > 0.72);
      const now = this.now(); const review = now + this.settings.reviewDays * DAY;
      if (same && same.status !== 'rejected') {
        // the same claim found again: merge sources; it can move up to verified (never down without a contradiction)
        const merged = [...same.sources, ...sources.filter((s) => !same.sources.some((x) => x.url === s.url))].slice(0, 6).map((s, i) => ({ ...s, id: i + 1 }));
        const orgs = new Set(merged.filter((s) => s.credibility !== 'low').map((s) => s.domain.split('.').slice(-2).join('.')));
        const status: Verification = c.status === 'conflicting' ? 'conflicting' : orgs.size >= 2 ? 'verified' : same.status === 'outdated' ? 'pending' : same.status;
        const upd = KnowledgeSchema.parse({ ...same, sources: merged, status, basis: status === 'verified' ? `Stated by ${orgs.size} independent sources (re-checked ${new Date(now).toLocaleDateString()}).` : c.basis, updatedAt: now, reviewAfter: review });
        this.knowledge = this.knowledge.map((k) => (k.id === same.id ? upd : k)); await this.d.kv.put('knowledge', upd); count[status === 'verified' ? 'verified' : status === 'conflicting' ? 'conflicting' : 'pending']++;
      } else if (!same) {
        const k = KnowledgeSchema.parse({ id: uid('kn'), claim: c.claim, topic: c.topic, category: c.category, status: c.status, basis: c.basis, sources, origin: 'research', reportId: r.id, createdAt: now, updatedAt: now, reviewAfter: review });
        this.knowledge = [k, ...this.knowledge].slice(0, LEARN_LIMITS.knowledge); await this.d.kv.put('knowledge', k); count[c.status === 'verified' ? 'verified' : c.status === 'conflicting' ? 'conflicting' : 'pending']++;
      }
    }
    return count;
  }

  /* ---------------- knowledge ---------------- */
  /** knowledge for a chat turn (only when allowed); marks items as used */
  contextFor(question: string) {
    if (!this.settings.useKnowledge) return [];
    const hits = retrieve(this.knowledge, question, 4, this.now());
    for (const h of hits) { const k = this.knowledge.find((x) => x.id === h.id); if (k) k.uses++; }
    return hits.map((k) => ({ claim: k.claim, status: k.status as Exclude<Verification, 'rejected'>, sources: k.sources.slice(0, 3).map((s) => `${s.title} (${s.domain})`) }));
  }
  async setStatus(id: string, status: Verification, note = '') {
    const k = this.knowledge.find((x) => x.id === id); if (!k) return;
    const upd = KnowledgeSchema.parse({ ...k, status, userEdited: true, basis: status === 'verified' && k.status !== 'verified' ? `Marked verified by you${note ? `: ${note}` : ''}.` : status === 'rejected' ? `Rejected by you${note ? `: ${note}` : ''}.` : k.basis, updatedAt: this.now() });
    this.knowledge = this.knowledge.map((x) => (x.id === id ? upd : x)); await this.d.kv.put('knowledge', upd);
    await this.log('user', `knowledge → ${status}`, k.claim.slice(0, 120), note); this.changed();
  }
  async editClaim(id: string, claim: string) {
    const k = this.knowledge.find((x) => x.id === id); const c = claim.trim().slice(0, LEARN_LIMITS.claim); if (!k || c.length < 3) return;
    const upd = KnowledgeSchema.parse({ ...k, claim: c, userEdited: true, status: k.status === 'verified' ? 'pending' : k.status, basis: k.status === 'verified' ? 'Edited by you — the sources were checked against the old wording.' : k.basis, updatedAt: this.now() });
    this.knowledge = this.knowledge.map((x) => (x.id === id ? upd : x)); await this.d.kv.put('knowledge', upd);
    await this.log('user', 'correct knowledge', c.slice(0, 120), `was: ${k.claim.slice(0, 200)}`); this.changed();
  }
  async deleteKnowledge(id: string) { const k = this.knowledge.find((x) => x.id === id); this.knowledge = this.knowledge.filter((x) => x.id !== id); await this.d.kv.del('knowledge', id).catch(() => {}); await this.log('user', 'delete knowledge', k?.claim.slice(0, 120) ?? id); this.changed(); }
  /** something the user tells NEXUS directly (kept as pending: told by you, not independently verified) */
  async teach(claim: string, topic = '') {
    const c = claim.trim().slice(0, LEARN_LIMITS.claim); if (c.length < 3 || looksSensitive(c)) return null;
    const now = this.now();
    const k = KnowledgeSchema.parse({ id: uid('kn'), claim: c, topic: topic || topicOf(c), status: 'pending', basis: 'Told by you; not independently verified.', origin: 'user', createdAt: now, updatedAt: now, reviewAfter: now + this.settings.reviewDays * DAY });
    this.knowledge = [k, ...this.knowledge]; await this.d.kv.put('knowledge', k); await this.log('user', 'teach', c.slice(0, 120)); this.changed(); return k;
  }

  /* ---------------- reflection ---------------- */
  async reflect(signal?: AbortSignal): Promise<Reflection | null> {
    const pending = this.experiences.filter((e) => !e.processed).slice(0, 30);
    if (!pending.length) { this.lastError = 'There are no new experiences to reflect on yet.'; this.changed(); return null; }
    if (this.d.aiAvailable() === false) { this.lastError = 'No AI model is connected, so NEXUS cannot reflect.'; this.changed(); return null; }
    this.busy = `Reflecting on ${pending.length} experience(s)`; this.lastError = null; this.changed();
    const end = this.d.activity?.('reflecting', `${pending.length} experiences`);
    try {
      const raw = await this.d.task('/api/learn/reflect', { experiences: pending.map((e) => ({ id: e.id, type: e.type, summary: e.summary, topic: e.topic })) }, signal) as Record<string, unknown>;
      const r = ReflectionSchema.parse({ ...raw, id: uid('rf'), kind: 'reflection', at: this.now(), experienceIds: pending.map((e) => e.id) });
      this.reports = [r, ...this.reports].slice(0, LEARN_LIMITS.reports); await this.d.kv.put('research', r);
      for (const e of pending) { e.processed = true; await this.d.kv.put('experiences', e).catch(() => {}); }
      await this.log('nexus', 'reflection', `${pending.length} experiences`, `${r.lessons.length} lessons, ${r.proposals.length} proposals`);
      end?.('done'); this.busy = null; this.changed(); return r;
    } catch (e) { end?.('failed'); this.busy = null; this.lastError = `Reflection failed: ${(e as Error).message}`; await this.log('nexus', 'reflection failed', '', (e as Error).message); this.changed(); return null; }
  }
  async decideProposal(reflectionId: string, i: number, approve: boolean) {
    const r = this.reports.find((x) => x.id === reflectionId && x.kind === 'reflection') as Reflection | undefined; const p = r?.proposals[i]; if (!r || !p) return;
    p.status = approve ? 'approved' : 'dismissed'; await this.d.kv.put('research', r);
    await this.log('user', approve ? 'approve proposal' : 'dismiss proposal', p.text.slice(0, 120));
    if (approve && p.kind === 'research') { this.queue = [{ question: p.text, at: this.now(), trigger: 'user' as const, approved: true }, ...this.queue].slice(0, 30); await this.d.kv.put('kv', this.queue, 'learn.queue').catch(() => {}); }
    this.changed();
  }

  /* ---------------- workflow skills ---------------- */
  async draftSkill(goal: string): Promise<WorkflowSkill | null> {
    if (this.d.aiAvailable() === false) { this.lastError = 'No AI model is connected, so NEXUS cannot draft a skill.'; this.changed(); return null; }
    this.busy = 'Drafting a skill'; this.lastError = null; this.changed();
    try {
      const r = await this.d.task('/api/learn/skill/draft', { goal }) as { name: string; body: unknown };
      const body = SkillBodySchema.parse(r.body); const now = this.now();
      const s = WorkflowSkillSchema.parse({ id: uid('ws'), name: String(r.name).slice(0, 60), versions: [{ version: 1, body, status: 'draft', createdAt: now, createdBy: 'nexus', note: `Drafted for: ${goal.slice(0, 200)}` }], active: null, metrics: { runs: 0, ok: 0, failed: 0, lastRunAt: null }, createdAt: now, updatedAt: now });
      this.skills = [s, ...this.skills].slice(0, LEARN_LIMITS.skills); await this.d.kv.put('wskills', s); await this.log('nexus', 'draft skill', s.name, 'version 1 (draft — needs tests and your approval)');
      this.busy = null; this.changed(); return s;
    } catch (e) { this.busy = null; this.lastError = `Drafting failed: ${(e as Error).message}`; this.changed(); return null; }
  }
  private async saveSkill(s: WorkflowSkill) { const v = WorkflowSkillSchema.parse({ ...s, updatedAt: this.now() }); this.skills = this.skills.map((x) => (x.id === v.id ? v : x)); await this.d.kv.put('wskills', v); this.changed(); return v; }
  private async runRaw(s: WorkflowSkill, body: SkillBody, input: string, signal?: AbortSignal) { return ((await this.d.task('/api/learn/skill/run', { name: s.name, body, input }, signal)) as { output: string }).output ?? ''; }
  /** runs every test of a version in isolation (the active version is not touched) */
  async testVersion(id: string, version: number, signal?: AbortSignal): Promise<TestResult | null> {
    const s = this.skills.find((x) => x.id === id); const v = s?.versions.find((x) => x.version === version); if (!s || !v) return null;
    this.busy = `Testing ${s.name} v${version}`; this.lastError = null; this.changed();
    const failures: string[] = []; let passed = 0;
    try {
      for (const [i, t] of v.body.tests.entries()) { const out = await this.runRaw(s, v.body, t.input, signal); const r = evaluateTest(t, out); if (r.ok) passed++; else failures.push(`Test ${i + 1}: ${r.why}`); }
    } catch (e) { this.busy = null; this.lastError = `Testing stopped: ${(e as Error).message}`; this.changed(); return null; }
    const res: TestResult = { passed, total: v.body.tests.length, at: this.now(), failures };
    v.tests = res; await this.saveSkill(s); await this.log('nexus', 'test skill', `${s.name} v${version}`, `${passed}/${res.total} passed${failures.length ? ` — ${failures.join('; ')}` : ''}`);
    this.busy = null; this.changed(); return res;
  }
  /** approval: only a version whose latest tests all passed can become active; the old active one is kept for rollback */
  async approve(id: string, version: number): Promise<{ ok: boolean; why?: string }> {
    const s = this.skills.find((x) => x.id === id); const v = s?.versions.find((x) => x.version === version); if (!s || !v) return { ok: false, why: 'not found' };
    if (!v.tests || v.tests.passed !== v.tests.total) return { ok: false, why: 'Run the tests first — every test must pass before a version can be approved.' };
    for (const x of s.versions) if (x.status === 'active') x.status = 'retired';
    v.status = 'active'; s.active = version; await this.saveSkill(s); await this.log('user', 'approve skill', `${s.name} v${version}`, `tests ${v.tests.passed}/${v.tests.total}`); return { ok: true };
  }
  async reject(id: string, version: number) { const s = this.skills.find((x) => x.id === id); const v = s?.versions.find((x) => x.version === version); if (!s || !v || v.status === 'active') return; v.status = 'rejected'; await this.saveSkill(s); await this.log('user', 'reject skill version', `${s.name} v${version}`); }
  async rollback(id: string): Promise<boolean> {
    const s = this.skills.find((x) => x.id === id); if (!s || !s.active) return false;
    const prev = [...s.versions].filter((v) => v.status === 'retired' && v.version < s.active!).sort((a, b) => b.version - a.version)[0]; if (!prev) return false;
    const cur = s.versions.find((v) => v.version === s.active)!; cur.status = 'rejected'; prev.status = 'active'; s.active = prev.version;
    await this.saveSkill(s); await this.log('user', 'rollback skill', s.name, `v${cur.version} → v${prev.version}`); return true;
  }
  /** proposes a new version from recorded problems; it starts as a draft and must pass tests + approval */
  async improve(id: string, problems: string[]): Promise<SkillVersion | null> {
    const s = this.skills.find((x) => x.id === id); if (!s) return null;
    const base = s.versions.find((v) => v.version === (s.active ?? s.versions.at(-1)!.version))!;
    this.busy = `Improving ${s.name}`; this.lastError = null; this.changed();
    try {
      const r = await this.d.task('/api/learn/skill/draft', { goal: base.body.description, current: base.body, problems: problems.slice(0, 6) }) as { body: unknown };
      const body = SkillBodySchema.parse(r.body); body.tests = [...base.body.tests, ...body.tests.filter((t) => !base.body.tests.some((b) => b.input === t.input))].slice(0, 6);   // old tests must still pass
      const v: SkillVersion = { version: Math.max(...s.versions.map((x) => x.version)) + 1, body, status: 'draft', createdAt: this.now(), createdBy: 'nexus', note: `Improvement for: ${problems.join('; ').slice(0, 250)}`, tests: null };
      s.versions = [...s.versions, v].slice(-LEARN_LIMITS.versions); await this.saveSkill(s); await this.log('nexus', 'propose skill version', `${s.name} v${v.version}`, v.note);
      this.busy = null; this.changed(); return v;
    } catch (e) { this.busy = null; this.lastError = `Improvement failed: ${(e as Error).message}`; this.changed(); return null; }
  }
  /** runs the ACTIVE version on an input; success/failure counted from real runs */
  async runSkill(id: string, input: string, signal?: AbortSignal): Promise<string | null> {
    const s = this.skills.find((x) => x.id === id); const v = s?.versions.find((x) => x.version === s.active); if (!s || !v) { this.lastError = 'This skill has no approved version yet.'; this.changed(); return null; }
    try {
      const out = await this.runRaw(s, v.body, input, signal);
      s.metrics = { ...s.metrics, runs: s.metrics.runs + 1, ok: s.metrics.ok + 1, lastRunAt: this.now() }; await this.saveSkill(s);
      await this.record({ type: 'skill-run', summary: `Ran skill “${s.name}” v${v.version}`, topic: s.name, source: 'skill', ref: s.id });
      return out;
    } catch (e) { s.metrics = { ...s.metrics, runs: s.metrics.runs + 1, failed: s.metrics.failed + 1, lastRunAt: this.now() }; await this.saveSkill(s); this.lastError = `Skill failed: ${(e as Error).message}`; this.changed(); return null; }
  }
  async deleteSkill(id: string) { const s = this.skills.find((x) => x.id === id); this.skills = this.skills.filter((x) => x.id !== id); await this.d.kv.del('wskills', id).catch(() => {}); await this.log('user', 'delete skill', s?.name ?? id); this.changed(); }

  /* ---------------- background learning ---------------- */
  private armBackground() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.settings.background && !this.settings.paused && typeof setInterval === 'function') this.timer = setInterval(() => { void this.tick(); }, 60000);
  }
  /** One background step, if allowed now. Returns what it did ('' = nothing). Exposed for tests and the dashboard. */
  async tick(force = false): Promise<string> {
    const s = this.settings;
    if (!force && (!s.background || s.paused)) return '';
    if (this.busy || this.background.running) return '';
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return '';
    if (this.d.idle && !this.d.idle()) return '';
    if (!force && this.background.lastRunAt && this.now() - this.background.lastRunAt < s.intervalMin * 60000) return '';
    if (!this.canResearch().ok) return '';
    // 1) approved research questions, 2) knowledge due for a re-check
    const qi = this.queue.findIndex((q) => q.approved);
    const due = this.knowledge.find((k) => k.status === 'verified' && k.reviewAfter < this.now());
    if (qi < 0 && !due) return '';
    this.background.running = true; this.changed();
    try {
      if (qi >= 0) {
        const q = this.queue[qi]; this.queue.splice(qi, 1); await this.d.kv.put('kv', this.queue, 'learn.queue').catch(() => {});
        const r = await this.research(q.question, q.trigger === 'gap' ? 'gap' : 'background');
        this.background.lastResult = r ? `Researched “${q.question.slice(0, 80)}”: ${r.claims.length} claim(s) from ${r.sources.length} source(s).` : `Research for “${q.question.slice(0, 80)}” failed.`;
      } else if (due) {
        const r = await this.research(due.claim, 'recheck');
        const still = r?.claims.some((c) => similarity(c.claim, due.claim) > 0.72 && c.status === 'verified');
        if (!still) { const k = this.knowledge.find((x) => x.id === due.id); if (k && k.status === 'verified') { const upd = KnowledgeSchema.parse({ ...k, status: 'outdated', basis: 'A re-check did not confirm it again; treat as outdated until verified.', updatedAt: this.now() }); this.knowledge = this.knowledge.map((x) => (x.id === k.id ? upd : x)); await this.d.kv.put('knowledge', upd); } }
        this.background.lastResult = r ? `Re-checked “${due.claim.slice(0, 80)}”: ${still ? 'confirmed again' : 'not confirmed — marked outdated'}.` : 'A re-check failed.';
      }
      this.background.lastRunAt = this.now(); await this.log('nexus', 'background step', '', this.background.lastResult);
      return this.background.lastResult;
    } finally { this.background.running = false; this.changed(); }
  }

  /* ---------------- metrics (counted, never estimated) ---------------- */
  metrics() {
    const by = <T extends string>(xs: { [k: string]: unknown }[], key: string) => xs.reduce<Record<T, number>>((a, x) => { const k = x[key] as T; a[k] = (a[k] ?? 0) + 1; return a; }, {} as Record<T, number>);
    const research = this.reports.filter((r): r is ResearchReport => r.kind === 'research');
    const fb = this.experiences.filter((e) => e.type === 'feedback-positive' || e.type === 'feedback-negative');
    return {
      knowledge: { total: this.knowledge.length, byStatus: by<Verification>(this.knowledge, 'status'), used: this.knowledge.reduce((a, k) => a + k.uses, 0) },
      experiences: { total: this.experiences.length, byType: by<Experience['type']>(this.experiences, 'type'), unprocessed: this.experiences.filter((e) => !e.processed).length },
      research: { reports: research.length, sources: research.reduce((a, r) => a + r.sources.length, 0), today: this.daily.day === today(this.now()) ? this.daily.n : 0, limit: this.settings.dailyResearch },
      reflections: this.reports.filter((r) => r.kind === 'reflection').length,
      skills: { total: this.skills.length, active: this.skills.filter((s) => s.active).length, runs: this.skills.reduce((a, s) => a + s.metrics.runs, 0), failed: this.skills.reduce((a, s) => a + s.metrics.failed, 0) },
      feedback: { total: fb.length, helpful: fb.filter((e) => e.type === 'feedback-positive').length },
      queue: { waiting: this.queue.filter((q) => !q.approved).length, approved: this.queue.filter((q) => q.approved).length },
    };
  }
  notice(msg: string | null) { this.lastError = msg; this.changed(); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

export const topicOf = (s: string) => terms(s).slice(0, 5).join(' ').slice(0, 80);
