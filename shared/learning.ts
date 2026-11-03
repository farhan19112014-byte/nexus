/**
 * NEXUS learning engine — shared data formats (browser + server).
 *
 * "Learning" here means DATA kept around the language model: experiences, verified knowledge with sources, research
 * reports, reflections, and workflow skills with tests and versions. The underlying model (e.g. Gemini) is never
 * retrained or modified. Everything is validated with strict bounds; text that came from the web is stored as data.
 */
import { z } from 'zod';

export const LEARN_LIMITS = { experiences: 500, knowledge: 1000, reports: 200, skills: 60, versions: 12, audit: 2000, claim: 400, summary: 300, sourcesPerReport: 8, claimsPerReport: 8, retentionDays: 90 };

export const EXPERIENCE_TYPES = ['correction', 'feedback-positive', 'feedback-negative', 'failure', 'repeated-question', 'knowledge-gap', 'holo-failure', 'skill-run'] as const;
export const ExperienceSchema = z.object({
  id: z.string().min(1).max(64),
  at: z.number(),
  type: z.enum(EXPERIENCE_TYPES),
  /** short, redacted description — never a whole conversation */
  summary: z.string().min(1).max(LEARN_LIMITS.summary),
  topic: z.string().max(120).default(''),
  source: z.enum(['chat', 'holobuild', 'research', 'skill']),
  /** message / model / skill id the experience refers to */
  ref: z.string().max(80).default(''),
  /** included in a reflection already */
  processed: z.boolean().default(false),
}).strict();
export type Experience = z.infer<typeof ExperienceSchema>;

export const VERIFICATION = ['pending', 'verified', 'conflicting', 'outdated', 'rejected'] as const;
export type Verification = (typeof VERIFICATION)[number];
export const CATEGORIES = ['science', 'technology', 'engineering', 'history', 'geography', 'health', 'culture', 'language', 'user-domain', 'other'] as const;
export const SourceRefSchema = z.object({
  id: z.number().int().min(1).max(50),
  title: z.string().max(200),
  url: z.string().max(500).regex(/^https?:\/\//),
  domain: z.string().max(120),
  retrievedAt: z.string().max(40),
  credibility: z.enum(['high', 'medium', 'low']),
}).strict();
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const KnowledgeSchema = z.object({
  id: z.string().min(1).max(64),
  claim: z.string().min(3).max(LEARN_LIMITS.claim),
  topic: z.string().max(120).default(''),
  category: z.enum(CATEGORIES).default('other'),
  status: z.enum(VERIFICATION),
  /** why it has that status, in plain words */
  basis: z.string().max(300).default(''),
  sources: z.array(SourceRefSchema).max(6).default([]),
  origin: z.enum(['research', 'user-correction', 'user']),
  reportId: z.string().max(64).default(''),
  createdAt: z.number(), updatedAt: z.number(),
  /** re-check after this time (then it counts as outdated until re-verified) */
  reviewAfter: z.number(),
  userEdited: z.boolean().default(false),
  uses: z.number().int().min(0).default(0),
}).strict();
export type Knowledge = z.infer<typeof KnowledgeSchema>;

export const ReportClaimSchema = z.object({
  claim: z.string().min(3).max(LEARN_LIMITS.claim),
  topic: z.string().max(120).default(''),
  category: z.enum(CATEGORIES).default('other'),
  sources: z.array(z.number().int().min(1).max(50)).max(8).default([]),
  contradictedBy: z.array(z.number().int().min(1).max(50)).max(8).default([]),
  status: z.enum(VERIFICATION),
  basis: z.string().max(300).default(''),
}).strict();
export const ResearchReportSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.literal('research'),
  question: z.string().min(2).max(300),
  trigger: z.enum(['user', 'gap', 'background', 'recheck']),
  at: z.number(),
  queries: z.array(z.string().max(200)).max(4),
  provider: z.string().max(40),
  sources: z.array(SourceRefSchema).max(LEARN_LIMITS.sourcesPerReport),
  summary: z.string().max(1200),
  claims: z.array(ReportClaimSchema).max(LEARN_LIMITS.claimsPerReport),
  contradictions: z.array(z.string().max(300)).max(6).default([]),
  model: z.string().max(120).default(''),
}).strict();
export type ResearchReport = z.infer<typeof ResearchReportSchema>;

export const ReflectionSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.literal('reflection'),
  at: z.number(),
  experienceIds: z.array(z.string().max(64)).max(40),
  wentWell: z.array(z.string().max(300)).max(6).default([]),
  wentWrong: z.array(z.string().max(300)).max(6).default([]),
  lessons: z.array(z.object({ lesson: z.string().max(300), evidence: z.array(z.string().max(64)).max(10) }).strict()).max(6).default([]),
  proposals: z.array(z.object({ kind: z.enum(['research', 'skill', 'behaviour']), text: z.string().max(300), status: z.enum(['open', 'approved', 'dismissed']).default('open') }).strict()).max(6).default([]),
  model: z.string().max(120).default(''),
}).strict();
export type Reflection = z.infer<typeof ReflectionSchema>;

/* ------------------------------------------------------------------ workflow skills */
export const SkillTestSchema = z.object({
  input: z.string().min(1).max(600),
  /** deterministic checks on the output (case-insensitive) */
  mustInclude: z.array(z.string().min(1).max(80)).max(6).default([]),
  mustNotInclude: z.array(z.string().min(1).max(80)).max(6).default([]),
  maxChars: z.number().int().min(20).max(6000).optional(),
  minChars: z.number().int().min(0).max(6000).optional(),
}).strict();
export type SkillTest = z.infer<typeof SkillTestSchema>;
export const SkillBodySchema = z.object({
  description: z.string().min(3).max(300),
  inputs: z.array(z.object({ name: z.string().min(1).max(40), description: z.string().max(200).default('') }).strict()).min(1).max(5),
  procedure: z.array(z.string().min(3).max(300)).min(1).max(10),
  tools: z.array(z.enum(['conversation', 'knowledge', 'research', 'holobuild'])).max(4).default(['conversation']),
  output: z.string().min(3).max(300),
  limitations: z.string().max(400).default(''),
  tests: z.array(SkillTestSchema).min(1).max(6),
}).strict();
export type SkillBody = z.infer<typeof SkillBodySchema>;
export const TestResultSchema = z.object({ passed: z.number().int().min(0), total: z.number().int().min(0), at: z.number(), failures: z.array(z.string().max(300)).max(10).default([]) }).strict();
export type TestResult = z.infer<typeof TestResultSchema>;
export const SkillVersionSchema = z.object({
  version: z.number().int().min(1),
  body: SkillBodySchema,
  status: z.enum(['draft', 'active', 'rejected', 'retired']),
  createdAt: z.number(),
  createdBy: z.enum(['nexus', 'user']),
  note: z.string().max(300).default(''),
  tests: TestResultSchema.nullable().default(null),
}).strict();
export type SkillVersion = z.infer<typeof SkillVersionSchema>;
export const WorkflowSkillSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(2).max(60),
  versions: z.array(SkillVersionSchema).min(1).max(LEARN_LIMITS.versions),
  /** null until the user approves a version */
  active: z.number().int().min(1).nullable(),
  metrics: z.object({ runs: z.number().int().min(0), ok: z.number().int().min(0), failed: z.number().int().min(0), lastRunAt: z.number().nullable() }).strict(),
  createdAt: z.number(), updatedAt: z.number(),
}).strict();
export type WorkflowSkill = z.infer<typeof WorkflowSkillSchema>;

/** Deterministic test evaluation (no AI judging AI). */
export function evaluateTest(t: SkillTest, output: string): { ok: boolean; why: string } {
  const o = output.toLowerCase();
  for (const w of t.mustInclude) if (!o.includes(w.toLowerCase())) return { ok: false, why: `missing “${w}”` };
  for (const w of t.mustNotInclude) if (o.includes(w.toLowerCase())) return { ok: false, why: `contains “${w}”` };
  if (t.maxChars !== undefined && output.length > t.maxChars) return { ok: false, why: `${output.length} characters (max ${t.maxChars})` };
  if (t.minChars !== undefined && output.trim().length < t.minChars) return { ok: false, why: `${output.trim().length} characters (min ${t.minChars})` };
  return { ok: true, why: 'passed' };
}

export const AuditSchema = z.object({
  id: z.number().int().optional(),
  at: z.number(),
  actor: z.enum(['user', 'nexus']),
  action: z.string().min(1).max(60),
  target: z.string().max(120).default(''),
  detail: z.string().max(400).default(''),
}).strict();
export type Audit = z.infer<typeof AuditSchema>;

export const LearningSettingsSchema = z.object({
  /** record experiences at all */
  collect: z.boolean().default(true),
  /** when NEXUS notices a knowledge gap: research it automatically, ask first, or do nothing */
  gapResearch: z.enum(['off', 'ask', 'auto']).default('ask'),
  /** background learning while NEXUS is open (off by default) */
  background: z.boolean().default(false),
  paused: z.boolean().default(false),
  /** daily cap on research runs (each uses one AI request + web searches) */
  dailyResearch: z.number().int().min(0).max(50).default(5),
  /** minutes between background tasks */
  intervalMin: z.number().int().min(5).max(240).default(20),
  /** use learned knowledge in conversations */
  useKnowledge: z.boolean().default(true),
  /** knowledge older than this is re-checked (days) */
  reviewDays: z.number().int().min(7).max(730).default(180),
}).strict();
export type LearningSettings = z.infer<typeof LearningSettingsSchema>;

/* ------------------------------------------------------------------ retrieval (lexical, offline) */
const STOP = new Set('a an the of to in on for and or is are was were be been it its this that these those what which who whom how why when where do does did can could should would will with by from as at about into than then there their them they you your i me my we our us not no yes explain tell describe show give know please mean means work works something thing things more much very also just like'.split(' '));
export const terms = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/[\s-]+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w));
/** Ranks knowledge for a question: term overlap with claim + topic, weighted by status. Rejected items never match. */
export function retrieve(items: Knowledge[], question: string, k = 4, now = Date.now()): Knowledge[] {
  const q = new Set(terms(question)); if (!q.size) return [];
  const w: Record<Verification, number> = { verified: 1, pending: 0.7, conflicting: 0.6, outdated: 0.5, rejected: 0 };
  return items.filter((x) => x.status !== 'rejected').map((x) => {
    const t = new Set([...terms(x.claim), ...terms(x.topic)]); let hit = 0; for (const a of q) if (t.has(a)) hit++;
    const status = x.status === 'verified' && x.reviewAfter < now ? 'outdated' : x.status;
    return { x: { ...x, status }, s: (hit / Math.sqrt(q.size * Math.max(1, t.size))) * w[status] * (hit >= Math.min(2, q.size) ? 1 : 0.3) };
  }).filter((r) => r.s > 0.12).sort((a, b) => b.s - a.s).slice(0, k).map((r) => r.x);
}
/** Jaccard similarity of two claims' terms (dedupe). */
export function similarity(a: string, b: string): number {
  const A = new Set(terms(a)), B = new Set(terms(b)); if (!A.size || !B.size) return 0;
  let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i);
}
