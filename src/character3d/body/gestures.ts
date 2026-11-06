/**
 * Conversational gestures for NEXUS: the forms its arms can make (authored against the real skeleton, like the clip
 * library, and collision-checked by the tests) and a planner that reads a sentence and decides WHICH gesture fits what
 * is being said — a question opens both palms, "you" offers a palm toward the listener, "I" brings a hand to the chest,
 * "but" switches hands, "huge"/"tiny" shows a size, "not" sweeps a palm down, "this" with a visual on screen points at
 * it — and where in the sentence its stroke belongs. Plain sentences get a few calm beats, short ones none at all.
 *
 * The rig has a ball hand with one thumb (no fingers), so meaning is carried by palm direction, height, distance and
 * which hand moves — not by finger shapes. Coordinates: Body space of the RIGHT arm (−x), mirrored for the left.
 */
import type { V3 } from './math';
import type { Rng } from './rng';
import { pick, range } from './rng';

export type Hand = 'L' | 'R' | 'both';
export interface Form {
  id: string;
  /** palm target (right arm, Body space), hand euler (deg: x = flex palm up −, z = roll outward), elbow pole */
  at: V3; hand: V3; pole?: V3;
  /** direction (Body space, right arm) the palm travels on the stroke, metres — the beat itself */
  stroke: V3;
  /** default hands */
  hands: Hand;
  /** thumb opening 0 (relaxed, along the palm) … 1 (spread open) */
  thumb: number;
  /** extra head motion on the stroke (deg: nod, turn, tilt) and brow lift (channel units) */
  head?: V3; brow?: number;
  doc: string;
}
/** every form keeps the palm ≥ 0.56 m in front of the torso's centre line or out beside it (the torso shell is 0.43 deep) */
export const FORMS: Record<string, Form> = {
  beat: { id: 'beat', at: [-0.64, 0.42, 0.5], hand: [-18, 0, 0], stroke: [0, -0.05, 0.02], hands: 'R', thumb: 0.2, doc: 'a small downward beat, palm half down — the commonest speech gesture' },
  open_palm: { id: 'open_palm', at: [-0.8, 0.5, 0.44], hand: [-38, 0, 12], stroke: [-0.04, -0.03, 0.03], hands: 'R', thumb: 0.8, doc: 'palm turned up and out: "here is the idea"' },
  offer: { id: 'offer', at: [-0.7, 0.5, 0.6], hand: [-48, 0, 10], stroke: [0, -0.02, 0.06], hands: 'R', thumb: 0.9, head: [2, 0, 0], doc: 'palm up toward the listener: "you", "your"' },
  self: { id: 'self', at: [-0.36, 0.62, 0.64], hand: [-62, 0, -8], pole: [-0.8, -0.7, -0.2], stroke: [0.02, 0, -0.03], hands: 'R', thumb: 0.3, doc: 'hand comes toward the chest: "I", "me", "my"' },
  frame: { id: 'frame', at: [-0.6, 0.5, 0.56], hand: [-30, 0, 0], stroke: [0.02, -0.03, 0.02], hands: 'both', thumb: 0.5, doc: 'both hands hold an idea in front of the body (explaining)' },
  wide: { id: 'wide', at: [-0.9, 0.55, 0.4], hand: [-40, 0, 14], stroke: [-0.05, 0, 0], hands: 'both', thumb: 1, brow: 0.25, doc: 'hands apart: big, huge, everything, all of it' },
  small: { id: 'small', at: [-0.4, 0.55, 0.64], hand: [-20, 0, -12], stroke: [0.03, 0, 0], hands: 'both', thumb: 0.3, doc: 'hands close together: small, tiny, a little bit' },
  question: { id: 'question', at: [-0.82, 0.44, 0.46], hand: [-44, 0, 14], stroke: [-0.03, 0.02, 0.02], hands: 'both', thumb: 1, head: [0, 0, 6], brow: 0.35, doc: 'both palms up, head tilted: a question' },
  negate: { id: 'negate', at: [-0.66, 0.46, 0.54], hand: [14, 0, -6], stroke: [-0.14, -0.02, -0.04], hands: 'R', thumb: 0.2, head: [0, 5, 0], doc: 'palm down, sweeping out to the side: not, never, no' },
  emphasis: { id: 'emphasis', at: [-0.66, 0.56, 0.5], hand: [-10, 0, 0], stroke: [0, -0.09, 0.02], hands: 'R', thumb: 0.15, head: [5, 0, 0], brow: 0.2, doc: 'a firmer downward stroke on an important word' },
  present: { id: 'present', at: [-0.86, 0.7, 0.54], hand: [-28, 0, 0], stroke: [-0.03, 0, 0.03], hands: 'R', thumb: 0.8, doc: 'an open arm toward something shown beside NEXUS' },
  count: { id: 'count', at: [-0.7, 0.5, 0.5], hand: [-24, 0, 4], stroke: [0, -0.04, 0.03], hands: 'R', thumb: 0.5, doc: 'enumerating: first, second, then, finally — alternating hands' },
};

/** how the palm is placed for a pointing target (deg) and how far forward the arm may go */
export const POINT = { hand: [8, 0, 0] as V3, thumb: 0.6, reach: 0.7 };

export interface GestureIntent {
  form: string; hand: 'L' | 'R' | 'both';
  /** position of the stroke in the sentence, 0…1 (word position) */
  at: number;
  /** 0.6 (light) … 1.3 (strong) */
  intensity: number;
  /** point at the current visual target instead of a fixed form */
  point?: boolean;
  /** the word that triggered it (debugging and tests) */
  why: string;
}

const RX = {
  self: /^(i|i'm|i've|i'll|i'd|me|my|myself|mine)$/,
  you: /^(you|your|you're|yours|yourself)$/,
  contrast: /^(but|however|although|though|whereas|instead|yet|otherwise)$/,
  negate: /^(not|no|never|don't|doesn't|can't|cannot|won't|isn't|aren't|wasn't|nothing|none|neither|nor)$/,
  big: /^(big|bigger|huge|enormous|massive|giant|large|larger|vast|whole|entire|all|everything|everywhere|everyone|wide|lots|many)$/,
  small: /^(small|smaller|tiny|little|bit|tinier|slightly|few|narrow|minor)$/,
  count: /^(first|firstly|second|secondly|third|thirdly|then|next|finally|lastly|also|another|one|two|three|four)$/,
  emphasis: /^(very|really|important|key|crucial|essential|always|must|exactly|definitely|absolutely|extremely|most|best|only)$/,
  deixis: /^(this|these|here|look|see|shown|picture|image|diagram|chart|graph|photo|map|part|model)$/,
};

/** split into words with their positions 0…1 */
function words(text: string) {
  const w = text.toLowerCase().replace(/[“”"()[\]{}*_#]/g, ' ').split(/\s+/).map((x) => x.replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '')).filter(Boolean);
  return w.map((x, i) => ({ w: x, at: w.length > 1 ? i / (w.length - 1) : 0 }));
}

export interface PlanContext {
  state: 'speaking' | 'explaining';
  /** a visual (IVES panel, HOLOBUILD model) is on screen and its position is known */
  visual: boolean;
  /** hand used last (alternation) and the last forms (variation) */
  lastHand: 'L' | 'R'; recent: string[];
  /** the visual sits on this side of the robot (viewer's right = robot's left = 'L') */
  visualSide: 'L' | 'R' | null;
}

/**
 * Decide the gestures for one sentence. Rules first (meaning), then calm beats to fill long sentences — at most one
 * gesture per ~5 words, and some sentences deliberately get none (people do not gesture on every sentence).
 */
export function planSentence(text: string, ctx: PlanContext, rng: Rng): GestureIntent[] {
  const ws = words(text); const n = ws.length; const out: GestureIntent[] = [];
  if (!n) return out;
  const question = /\?\s*$/.test(text.trim());
  const exclaim = /!\s*$/.test(text.trim());
  let hand: 'L' | 'R' = ctx.lastHand === 'L' ? 'R' : 'L';
  // meaning beats filler: pointing at a visual, a contrast, a question, a negation outrank a counting word or a beat
  const PRI: Record<string, number> = { present: 5, open_palm: 4, question: 4, negate: 4, offer: 3, self: 3, wide: 3, small: 3, emphasis: 2, count: 1, frame: 0, beat: 0 };
  const push = (g: Omit<GestureIntent, 'hand'> & { hand?: GestureIntent['hand'] }, pri = PRI[g.form] ?? 0) => {
    const clash = out.findIndex((x) => Math.abs(x.at - g.at) < 0.22);         // strokes need room between them
    if (clash >= 0) { if ((PRI[out[clash].form] ?? 0) >= pri) return; out.splice(clash, 1); }
    const f = FORMS[g.form]; const h = g.hand ?? (f?.hands === 'both' ? 'both' : hand);
    out.push({ ...g, hand: h }); if (h !== 'both') hand = h === 'L' ? 'R' : 'L';
  };
  let counting = 0;
  for (const { w, at } of ws) {
    if (RX.deixis.test(w) && ctx.visual && ctx.visualSide) push({ form: 'present', hand: ctx.visualSide, at, intensity: 1, point: true, why: w });
    else if (RX.self.test(w) && at < 0.5) push({ form: 'self', at, intensity: 0.9, why: w });
    else if (RX.you.test(w)) push({ form: 'offer', at, intensity: 0.9, why: w });
    else if (RX.contrast.test(w) && at > 0.05) { const prev = out[out.length - 1]; if (prev && prev.hand !== 'both') hand = prev.hand === 'L' ? 'R' : 'L'; push({ form: 'open_palm', at, intensity: 1, why: w }); }
    else if (RX.negate.test(w)) push({ form: 'negate', at, intensity: 1, why: w });
    else if (RX.big.test(w)) push({ form: 'wide', at, intensity: 1.1, why: w });
    else if (RX.small.test(w)) push({ form: 'small', at, intensity: 0.9, why: w });
    else if (RX.count.test(w) && (counting++ > 0 || /^(first|firstly|second|secondly|third|finally|lastly)$/.test(w))) push({ form: 'count', at, intensity: 0.9, why: w });
    else if (RX.emphasis.test(w)) push({ form: 'emphasis', at, intensity: 1.15, why: w });
  }
  if (question && !out.some((g) => g.at > 0.5)) push({ form: 'question', hand: 'both', at: 0.8, intensity: 1, why: '?' });
  // a short line ("Sure!", "Hi there.") usually gets no hands; a plain longer one a few calm beats
  const room = Math.max(0, Math.floor(n / 5) - out.length);
  if (!out.length && n < 4) return [];
  if (!out.length && rng() < (ctx.state === 'explaining' ? 0.1 : 0.3)) return [];   // sometimes just head and voice
  const filler = ctx.state === 'explaining' ? ['frame', 'open_palm', 'beat'] : ['beat', 'open_palm', 'beat'];
  for (let i = 0; i < room && out.length < 4; i++) {
    const at = (i + 0.5) / (room + 0.5) * 0.85; let f = pick(rng, filler);
    if (ctx.recent.slice(-2).every((x) => x === f)) f = filler.find((x) => x !== f) ?? f;
    push({ form: f, at, intensity: exclaim ? 1.15 : range(rng, 0.75, 1), why: 'beat' });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, 4);
}
