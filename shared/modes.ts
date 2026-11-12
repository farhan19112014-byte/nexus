/**
 * NEXUS modes — the mode registry shared by the browser and the server (one NEXUS, five operational modes).
 * The SERVER enforces it: a chat request's mode is validated against this table, selects that mode's instructions,
 * and its permissions decide which parts of the model's answer may take effect (server/modes/permissions.ts).
 * The browser uses the same table for the mode selector, accents and the robot's outfit.
 */
import { z } from 'zod';

export const MODE_IDS = ['default', 'education', 'medical', 'legal', 'it'] as const;
export type ModeId = (typeof MODE_IDS)[number];
export const OUTFIT_IDS = ['default', 'education', 'medical', 'legal', 'it'] as const;
export type OutfitId = (typeof OUTFIT_IDS)[number];

/** What a mode may do beyond answering in text. Enforced on the server, whatever the model outputs. */
export interface ModePermissions {
  /** live web research (sources) when the user has research on */
  research: boolean;
  /** pictures and diagrams beside the robot: all kinds, diagrams only, or none */
  visuals: 'all' | 'diagrams' | 'none';
  /** proposing / refining robot animations and gesture preferences */
  skills: boolean;
  /** suggesting things to remember (sensitive modes never store what is said in them) */
  memory: boolean;
}

export interface ModeDef {
  id: ModeId; name: string; tagline: string; description: string; icon: string;
  outfit: OutfitId;
  permissions: ModePermissions;
  /** a fixed scope notice shown with every answer in this mode (server text, not model text) */
  notice: string | null;
  /** which short option the mode uses (asked in the selector) */
  option: 'jurisdiction' | 'language' | 'level' | null;
  enabled: boolean;
}

export const MODES: Record<ModeId, ModeDef> = {
  default: {
    id: 'default', name: 'Default', tagline: 'Your everyday companion', description: 'Conversation, reasoning, ideas, writing and research — the original NEXUS.',
    icon: 'robot', outfit: 'default', permissions: { research: true, visuals: 'all', skills: true, memory: true }, notice: null, option: null, enabled: true,
  },
  education: {
    id: 'education', name: 'Educational', tagline: 'Learn, step by step', description: 'Explains concepts at your level, works through exercises and builds revision material.',
    icon: 'book', outfit: 'education', permissions: { research: true, visuals: 'all', skills: false, memory: true }, notice: null, option: 'level', enabled: true,
  },
  medical: {
    id: 'medical', name: 'Medical', tagline: 'Health information', description: 'Medical terms, reports, common conditions and questions for your doctor. Never a diagnosis.',
    icon: 'medical', outfit: 'medical', permissions: { research: true, visuals: 'diagrams', skills: false, memory: false },
    notice: 'General health information, not medical advice or a diagnosis. NEXUS is not a doctor — talk to a qualified healthcare professional about your situation.', option: null, enabled: true,
  },
  legal: {
    id: 'legal', name: 'Legal', tagline: 'Legal information', description: 'Legal terms, documents, procedures and legal systems explained. Not legal advice.',
    icon: 'scales', outfit: 'legal', permissions: { research: true, visuals: 'diagrams', skills: false, memory: false },
    notice: 'General legal information, not legal advice. NEXUS is not a lawyer; laws differ by jurisdiction and change — consult a qualified lawyer before acting.', option: 'jurisdiction', enabled: true,
  },
  it: {
    id: 'it', name: 'IT', tagline: 'Engineering & code', description: 'Programming, debugging, architecture, APIs, databases, performance and defensive security.',
    icon: 'code', outfit: 'it', permissions: { research: true, visuals: 'diagrams', skills: false, memory: true }, notice: null, option: 'language', enabled: true,
  },
};

export const isModeId = (x: unknown): x is ModeId => typeof x === 'string' && (MODE_IDS as readonly string[]).includes(x);
/** The mode a request really runs in: an unknown or disabled mode is never trusted — it runs as default. */
export const resolveMode = (x: unknown): ModeDef => (isModeId(x) && MODES[x].enabled ? MODES[x] : MODES.default);

/** Short per-mode settings a request may carry (plain words only; fenced as data in the prompt). */
const opt = (n: number) => z.string().trim().max(n).regex(/^[\p{L}\p{N} .,'()&/+#-]*$/u, 'letters, numbers and simple punctuation only').optional();
export const ModeOptionsSchema = z.object({
  /** legal: e.g. "India", "England and Wales" */
  jurisdiction: opt(60),
  /** IT: main programming language / stack */
  language: opt(40),
  /** education: learner level, e.g. "Class 8", "first-year university" */
  level: opt(40),
}).strict();
export type ModeOptions = z.infer<typeof ModeOptionsSchema>;
