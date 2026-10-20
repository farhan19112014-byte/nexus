/**
 * Runtime-validated schemas shared by browser and server (Assets 48, 62, 64, 65, 93).
 * Everything crossing a trust boundary — model output, network payloads, IndexedDB rows,
 * imported files, search results — is parsed with these before use.
 */
import { z } from 'zod';
import { DEFAULT_ROBOT_NAME, effectiveRobotName } from './identity';
import { CHANNEL_NAMES, type Channel } from './channels';

const finite = z.number().refine(Number.isFinite, 'must be a finite number');

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */
export const EXPRESSION_IDS = [
  'neutral', 'happy', 'curious', 'surprised', 'thinking', 'confused', 'concerned', 'determined',
  'playful', 'resting', 'listening', 'error',
] as const;
export const BuiltinExpressionSchema = z.enum(EXPRESSION_IDS);
export type BuiltinExpression = z.infer<typeof BuiltinExpressionSchema>;

export const POSES = ['neutral', 'standing', 'resting', 'sitting', 'leaning', 'crouching', 'waving', 'reaching'] as const;
export const PoseSchema = z.enum(POSES);
export type Pose = z.infer<typeof PoseSchema>;

export const SPEAKING_STYLES = ['calm', 'warm', 'energetic', 'serious', 'playful', 'soft'] as const;
export const SpeakingStyleSchema = z.enum(SPEAKING_STYLES);
export type SpeakingStyle = z.infer<typeof SpeakingStyleSchema>;

export const EASINGS = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'step', 'backOut'] as const;
export const EasingSchema = z.enum(EASINGS);
export type Easing = z.infer<typeof EasingSchema>;

export const SKILL_ID_RE = /^[a-z][a-z0-9_]{1,47}$/;
export const SkillIdSchema = z.string().regex(SKILL_ID_RE, 'id must be snake_case, 2–48 chars');
export const ChannelSchema = z.enum(CHANNEL_NAMES as [Channel, ...Channel[]]);

/* ------------------------------------------------------------------ */
/* Declarative skill format (Asset 62) — data only, no code            */
/* ------------------------------------------------------------------ */
export const LIMITS = {
  skillMaxDuration: 20,       // s, single play
  skillMaxTotal: 40,          // s, worst case with repetitions & slowest speed
  maxTracks: 40,
  maxKeysPerTrack: 64,
  maxCompositeSteps: 12,
  messageChars: 4000,
  messages: 40,
  totalChars: 24000,
  catalogEntries: 80,
  memoryItems: 12,
  researchResults: 5,
};

export const KeyframeSchema = z.object({
  t: finite.min(0).max(LIMITS.skillMaxDuration),
  v: finite,
  ease: EasingSchema.optional(),
}).strict();
export type Keyframe = z.infer<typeof KeyframeSchema>;

export const TrackSchema = z.object({
  channel: ChannelSchema,
  keys: z.array(KeyframeSchema).min(1).max(LIMITS.maxKeysPerTrack),
}).strict();
export type Track = z.infer<typeof TrackSchema>;

const Range = z.object({ min: finite, max: finite, default: finite }).strict()
  .refine((p) => p.min <= p.default && p.default <= p.max, 'default must lie within [min,max]');
export const SkillParamsSchema = z.object({
  speed: Range.default({ min: 0.5, max: 1.8, default: 1 }),
  amplitude: Range.default({ min: 0.3, max: 1.3, default: 1 }),
  repetitions: Range.default({ min: 1, max: 3, default: 1 }),
  mirrorable: z.boolean().default(true),
}).strict();

export const SKILL_KINDS = ['motion', 'expression', 'composite'] as const;
export const SKILL_STATUSES = ['builtin', 'proposed', 'approved', 'rejected', 'deprecated', 'failed'] as const;
export const CREATION_METHODS = ['builtin', 'procedural_generator', 'llm_motion', 'llm_expression', 'llm_composition', 'feedback_refinement', 'user', 'import'] as const;

export const CompositeStepSchema = z.object({
  skillId: SkillIdSchema,
  speed: finite.min(0.25).max(3).optional(),
  amplitude: finite.min(0).max(1.5).optional(),
  repetitions: z.number().int().min(1).max(6).optional(),
  side: z.enum(['left', 'right']).optional(),
}).strict();

export const SkillDefSchema = z.object({
  id: SkillIdSchema,
  name: z.string().min(1).max(60),
  description: z.string().max(400).default(''),
  version: z.number().int().min(1).max(100000).default(1),
  kind: z.enum(SKILL_KINDS),
  /** 1 = locomotion/idle, 2 = gestures, 3 = reactions. 4–5 reserved for the system (alerts, recovery). */
  priority: z.number().int().min(1).max(5).default(2),
  params: SkillParamsSchema.prefault({}),
  duration: finite.min(0.1).max(LIMITS.skillMaxDuration),
  loop: z.object({ start: finite.min(0), end: finite.min(0) }).strict().optional(),
  blendIn: finite.min(0.05).max(2).default(0.22),
  blendOut: finite.min(0.05).max(2).default(0.3),
  /** false = hold the final pose until replaced (e.g. sitting) */
  returnToRest: z.boolean().default(true),
  tracks: z.array(TrackSchema).max(LIMITS.maxTracks).default([]),
  steps: z.array(CompositeStepSchema).max(LIMITS.maxCompositeSteps).optional(),
  /** declared start/end pose for gesture compatibility (Asset 25) */
  startPose: z.enum(POSES).default('neutral'),
  endPose: z.enum(POSES).default('neutral'),
  prerequisites: z.array(SkillIdSchema).max(6).default([]),
  tags: z.array(z.string().max(24)).max(12).default([]),
  createdBy: z.enum(CREATION_METHODS).default('user'),
}).strict();
export type SkillDef = z.infer<typeof SkillDefSchema>;
export type SkillDefInput = z.input<typeof SkillDefSchema>;

/* Expression preset (Asset 20 / 64) */
export const ExpressionPresetSchema = z.object({
  id: SkillIdSchema,
  name: z.string().min(1).max(60),
  version: z.number().int().min(1).default(1),
  description: z.string().max(300).default(''),
  /** face channel targets; unspecified channels fall back to neutral */
  face: z.record(z.string(), finite).refine((o) => Object.keys(o).length <= 24, 'too many channels'),
  /** optional head pose that accompanies the expression */
  head: z.object({ rot: finite.optional(), nod: finite.optional(), y: finite.optional() }).strict().default({}),
  transitionMs: finite.min(60).max(2000).default(260),
  /** optional idle motion skill played while the expression is held */
  idleMotion: SkillIdSchema.nullable().default(null),
  blinkRate: finite.min(0.2).max(3).default(1),
  /** groups this expression may NOT be combined with (e.g. "mouth" while speaking) */
  exclusiveWith: z.array(z.enum(['speaking', 'listening'])).default([]),
  priority: z.number().int().min(0).max(5).default(1),
  tags: z.array(z.string().max(24)).max(12).default([]),
}).strict();
export type ExpressionPreset = z.infer<typeof ExpressionPresetSchema>;
export type ExpressionPresetInput = z.input<typeof ExpressionPresetSchema>;

/* Procedural motion generator spec (motif composition) */
export const MOTIFS = [
  'wave', 'raise_hand', 'point', 'open_arms', 'hand_on_chest', 'clap', 'fist_pump', 'salute',
  'nod', 'shake_head', 'head_tilt', 'bounce', 'sway', 'hop', 'shrug', 'spin_antenna', 'peek', 'step_side',
] as const;
export const MotifSchema = z.enum(MOTIFS);
export type Motif = z.infer<typeof MotifSchema>;

export const GeneratorSpecSchema = z.object({
  id: SkillIdSchema,
  name: z.string().min(1).max(60),
  description: z.string().max(400).default(''),
  motifs: z.array(z.object({
    motif: MotifSchema,
    side: z.enum(['left', 'right']).default('right'),
    intensity: finite.min(0.2).max(1.2).default(0.8),
    duration: finite.min(0.4).max(3).default(1),
    repeats: z.number().int().min(1).max(4).default(1),
    expression: BuiltinExpressionSchema.optional(),
  }).strict()).min(1).max(6),
  tags: z.array(z.string().max(24)).max(12).default([]),
}).strict();
export type GeneratorSpec = z.infer<typeof GeneratorSpecSchema>;

export const SkillProposalSchema = z.discriminatedUnion('format', [
  z.object({ format: z.literal('generator'), spec: GeneratorSpecSchema, reason: z.string().max(300).optional() }).strict(),
  z.object({ format: z.literal('motion'), skill: SkillDefSchema, reason: z.string().max(300).optional() }).strict(),
  z.object({ format: z.literal('composition'), skill: SkillDefSchema, reason: z.string().max(300).optional() }).strict(),
  z.object({ format: z.literal('expression'), expression: ExpressionPresetSchema, reason: z.string().max(300).optional() }).strict(),
]);
export type SkillProposal = z.infer<typeof SkillProposalSchema>;
export type SkillProposalInput = z.input<typeof SkillProposalSchema>;

/* ------------------------------------------------------------------ */
/* Brain response                                                      */
/* ------------------------------------------------------------------ */
export const ActionStepSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('skill'),
    skillId: z.string().max(48),
    speed: finite.min(0.25).max(3).optional(),
    amplitude: finite.min(0).max(1.5).optional(),
    repetitions: z.number().int().min(1).max(6).optional(),
    side: z.enum(['left', 'right']).optional(),
    timing: z.enum(['before_speech', 'with_speech', 'after_speech']).default('with_speech'),
  }).strict(),
  z.object({ type: z.literal('unsupported'), request: z.string().max(200), reason: z.string().max(300) }).strict(),
]);
export type ActionStep = z.infer<typeof ActionStepSchema>;

export const SkillRefinementSchema = z.object({
  skillId: z.string().max(48), // may be "last"
  speedFactor: finite.min(0.3).max(3).optional(),
  amplitudeFactor: finite.min(0.2).max(2).optional(),
  repetitions: z.number().int().min(1).max(3).optional(),
  note: z.string().max(300).default(''),
}).strict();
export type SkillRefinement = z.infer<typeof SkillRefinementSchema>;

export const PREFERENCE_CONTEXTS = ['greeting', 'farewell', 'agreement', 'celebration', 'thinking', 'apology'] as const;

export const MEMORY_CATEGORIES = ['preference', 'fact', 'rule', 'goal'] as const;
export const MemoryCandidateSchema = z.object({
  text: z.string().min(2).max(200),
  category: z.enum(MEMORY_CATEGORIES).default('fact'),
  /** short normalized key used for conflict detection, e.g. "response_length" */
  key: z.string().max(40).regex(/^[a-z0-9_]*$/).optional(),
  reason: z.string().max(160).default(''),
  /** true only if the user explicitly asked to remember this */
  explicit: z.boolean().default(false),
}).strict();
export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>;

/** Early, small metadata the model can emit before its reply text (streaming). */
export const BrainHeadSchema = z.object({
  expression: z.string().max(48).default('neutral'),
  emotionIntensity: finite.min(0).max(1).default(0.6),
  gesture: z.string().max(48).nullable().default(null),
  pose: PoseSchema.default('neutral'),
  speakingStyle: SpeakingStyleSchema.default('warm'),
});
export type BrainHead = z.infer<typeof BrainHeadSchema>;

export const BrainResponseSchema = BrainHeadSchema.extend({
  reply: z.string().min(1).max(6000),
  actions: z.array(ActionStepSchema).max(8).default([]),
  followUpAction: z.string().max(48).nullable().default(null),
  clarification: z.string().max(300).nullable().default(null),
  uncertainty: z.enum(['low', 'medium', 'high']).default('low'),
  skillProposal: SkillProposalSchema.nullable().default(null),
  skillRefinement: SkillRefinementSchema.nullable().default(null),
  preferenceUpdate: z.object({ context: z.enum(PREFERENCE_CONTEXTS), skillId: z.string().max(48) }).strict().nullable().default(null),
  feedback: z.object({ skillId: z.string().max(48), rating: z.enum(['up', 'down']), note: z.string().max(300).default('') }).strict().nullable().default(null),
  memoryCandidates: z.array(MemoryCandidateSchema).max(3).default([]),
  citations: z.array(z.number().int().min(1).max(10)).max(10).default([]),
});
export type BrainResponse = z.infer<typeof BrainResponseSchema>;

/* ------------------------------------------------------------------ */
/* Research (Assets 72–75)                                             */
/* ------------------------------------------------------------------ */
export const SourceSchema = z.object({
  id: z.number().int().min(1).max(10),
  title: z.string().min(1).max(300),
  url: z.string().url().max(2000).refine((u) => /^https?:\/\//.test(u), 'http(s) only'),
  snippet: z.string().max(2000),
  provider: z.string().max(40),
  retrievedAt: z.string().max(40),     // ISO timestamp of OUR retrieval, never invented
  publishedAt: z.string().max(40).nullable().default(null),
});
export type Source = z.infer<typeof SourceSchema>;

/* ------------------------------------------------------------------ */
/* API                                                                  */
/* ------------------------------------------------------------------ */
export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(LIMITS.messageChars + 2000),
}).strict();
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const SkillCatalogEntrySchema = z.object({
  id: z.string().max(48), name: z.string().max(60), description: z.string().max(200),
  kind: z.enum(SKILL_KINDS), tags: z.array(z.string().max(24)).max(12).default([]),
}).strict();
export type SkillCatalogEntry = z.infer<typeof SkillCatalogEntrySchema>;

export const UserProfileSchema = z.object({
  responseStyle: z.enum(['concise', 'balanced', 'detailed']).default('balanced'),
  language: z.string().max(40).default('English'),
  /** The robot's display name chosen by the user (trusted app configuration, validated here too). */
  robotName: z.string().max(200).default(DEFAULT_ROBOT_NAME).transform((v) => effectiveRobotName(v)),
}).strict();

export const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1).max(LIMITS.messages),
  skills: z.array(SkillCatalogEntrySchema).max(LIMITS.catalogEntries).default([]),
  expressions: z.array(z.string().max(48)).max(60).default([]),
  memory: z.array(z.string().max(300)).max(LIMITS.memoryItems).default([]),
  preferences: z.record(z.string().max(32), z.string().max(48)).default({}),
  profile: UserProfileSchema.prefault({}),
  lastSkillId: z.string().max(48).nullable().default(null),
  research: z.boolean().default(false),
  stream: z.boolean().default(true),
}).strict().refine((r) => Array.isArray(r.messages) && r.messages.reduce((n, m) => n + m.content.length, 0) <= LIMITS.totalChars, 'conversation too large')
  .refine((r) => r.messages.length > 0 && r.messages[r.messages.length - 1].role === 'user', 'last message must be from the user');
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type ChatRequestInput = z.input<typeof ChatRequestSchema>;

export const SummarizeRequestSchema = z.object({ messages: z.array(ChatMessageSchema).min(1).max(LIMITS.messages) }).strict();

export interface ServerCapabilities {
  provider: string;
  label: string;
  model: string | null;
  isLLM: boolean;
  configured: boolean;
  streaming: boolean;
  research: { provider: string; configured: boolean; note?: string };
  /** optional server-side speech; absent on older servers */
  speech?: { tts: { configured: boolean; note: string }; stt: { configured: boolean; note: string } };
  promptVersion: string;
  runtimeConfig: boolean;
  note?: string;
}

/** Server-sent stream events (POST /api/chat with stream:true). */
export type StreamEvent =
  | { type: 'status'; stage: 'researching' | 'thinking' | 'streaming' }
  | { type: 'sources'; sources: Source[] }
  | { type: 'head'; head: BrainHead }
  | { type: 'delta'; text: string }
  | { type: 'final'; response: BrainResponse; meta: ResponseMeta }
  | { type: 'error'; error: string; code: ErrorCode; retryable: boolean };

export type ErrorCode = 'timeout' | 'network' | 'provider' | 'rate_limited' | 'malformed' | 'unconfigured' | 'invalid_request' | 'cancelled' | 'research_failed' | 'internal' | 'offline';

export interface ResponseMeta {
  provider: string; model: string | null; isLLM: boolean; latencyMs: number; streamed: boolean;
  repaired: boolean; droppedFields: string[]; degraded: boolean; historySent: number; promptVersion: string;
  research: { used: boolean; provider: string | null; count: number; error?: string };
  /** 'compact' for small local models with a short context window */
  promptMode?: 'full' | 'compact';
}
