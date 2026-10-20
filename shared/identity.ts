/**
 * Identity boundaries (used by the browser app AND the server prompt builder).
 *
 *   PRODUCT_NAME   the product brand — never changes when the robot is renamed
 *   CHARACTER_ID   internal id of the robot character (storage keys, diagnostics) — never user-editable
 *   robot name     the user's display name for the robot ("NEXUS" until renamed) — see validateRobotName
 *
 * Conversation ids, provider/model ids and the app mode live in their own modules.
 */
export const PRODUCT_NAME = 'NEXUS';
export const CHARACTER_ID = 'nexus-robot-v2';
export const DEFAULT_ROBOT_NAME = 'NEXUS';
export const ROBOT_NAME_MAX = 32;

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

/** Characters that change text direction or are invisible: allowed nowhere in a name. */
const INVISIBLE_OR_BIDI = /[\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/u;
// Letters, marks, numbers, spaces, emoji and ordinary punctuation are fine; control characters,
// angle brackets and backticks are not (a name is plain text, never markup).
const CONTROL = /\p{Cc}/u;
// every other invisible formatting character (soft hyphen, Arabic letter mark, tag characters …) except the
// zero-width joiner that emoji sequences such as 👩‍🚀 need
const FORMAT_CHARS = /(?!\u200D)\p{Cf}|(?<!\p{Extended_Pictographic}\uFE0F?)\u200D|\u200D(?!\p{Extended_Pictographic})/u;
const MARKUP = /[<>`{}\\]/;

/** Counts user-perceived characters (so "Ñova" or an emoji counts as one each). */
export function nameLength(s: string): number {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<unknown> } }).Segmenter;
  if (Seg) { let n = 0; for (const _ of new Seg(undefined, { granularity: 'grapheme' }).segment(s)) { void _; n++; } return n; }
  return [...s].length;
}

export function validateRobotName(raw: unknown, max = ROBOT_NAME_MAX): NameCheck {
  if (typeof raw !== 'string') return { ok: false, error: 'The name must be text.' };
  const trimmed = raw.normalize('NFC').trim();
  if (!trimmed) return { ok: false, error: 'Please enter a name — it can’t be empty.' };
  if (CONTROL.test(trimmed)) return { ok: false, error: 'The name contains control characters (such as line breaks or tabs).' };
  const name = trimmed.replace(/\s+/gu, ' ');
  if (INVISIBLE_OR_BIDI.test(name) || FORMAT_CHARS.test(name)) return { ok: false, error: 'The name contains invisible or text-direction characters.' };
  if (MARKUP.test(name)) return { ok: false, error: 'Please avoid < > ` { } and \\ in the name.' };
  if (!/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(name)) return { ok: false, error: 'Use at least one letter, number or emoji.' };
  const len = nameLength(name);
  if (len > max) return { ok: false, error: `That’s ${len} characters — the limit is ${max}.` };
  return { ok: true, name };
}

/** The robot name to use, falling back to the default if a stored value is missing or invalid. */
export function effectiveRobotName(stored: unknown): string {
  const c = validateRobotName(stored);
  return c.ok ? c.name : DEFAULT_ROBOT_NAME;
}
