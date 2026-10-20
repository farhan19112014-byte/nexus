/**
 * DEMO BRAIN — a deterministic, rule-based responder used when no LLM is configured.
 * It is NOT an AI and says so. It understands movement commands, skill/expression invention,
 * feedback, gesture preferences, explicit "remember …" requests and a few social phrases, so the
 * body, face, skill pipeline and memory can be exercised without credentials.
 */
import { BrainResponseSchema, type ActionStep, type BrainResponse, type ChatRequest, type Pose, type Source } from './schema';
import { inventExpression, inventSpec } from '../src/skills/generator';

const R = (r: Partial<BrainResponse> & { reply: string }): BrainResponse => BrainResponseSchema.parse(r);
const NEG = /\b(don'?t|do not|never|stop|no need to|without)\b/;
const num = (t: string): number | undefined => {
  const w: Record<string, number> = { one: 1, once: 1, two: 2, twice: 2, three: 3, four: 4 };
  const m = /\b(\d+|one|once|two|twice|three|four)\s*(times|x)\b/.exec(t);
  return m ? (Number.isFinite(Number(m[1])) ? Number(m[1]) : w[m[1]]) : undefined;
};

const COMMANDS: { re: RegExp; id: string; label: string }[] = [
  { re: /\bwave\b|\bwaving\b/, id: 'wave', label: 'wave' },
  { re: /\bpoint\b/, id: 'point', label: 'point' },
  { re: /\braise (your |a )?hand\b/, id: 'raise_hand', label: 'raise my hand' },
  { re: /\bopen (your )?arms\b|\bhug\b/, id: 'open_arms', label: 'open my arms' },
  { re: /\bshrug/, id: 'shrug', label: 'shrug' },
  { re: /\bnod\b/, id: 'nod', label: 'nod' },
  { re: /\bshake (your )?head\b/, id: 'shake_head', label: 'shake my head' },
  { re: /\btilt\b/, id: 'head_tilt', label: 'tilt my head' },
  { re: /\blook (up|back)\b|\bhead back\b/, id: 'head_back', label: 'tilt my head back' },
  { re: /\blook down\b|\bhead forward\b|\blean (your head )?forward\b/, id: 'head_forward', label: 'lean my head forward' },
  { re: /\bclap\b/, id: 'clap', label: 'clap' },
  { re: /\bbounce\b|\bjump\b|\bhop\b/, id: 'bounce', label: 'bounce' },
  { re: /\bcelebrat|\bhooray\b|\bwoohoo\b/, id: 'celebrate', label: 'celebrate' },
  { re: /\bturn (to the |to your )?left\b/, id: 'turn_left', label: 'turn to my left' },
  { re: /\bturn (to the |to your )?right\b/, id: 'turn_right', label: 'turn to my right' },
  { re: /\bwalk\b|\bstroll\b|\bmove around\b/, id: 'walk_across', label: 'walk across' },
  { re: /\bthink\b.*\b(pose|gesture)\b|\bhand (to|on) (your )?chin\b/, id: 'think_chin', label: 'strike a thinking pose' },
  { re: /\bgreet(ing)? (me )?(again|properly)?\b|\bsay hi\b/, id: 'greeting', label: 'greet you' },
];
const POSE_CMDS: { re: RegExp; pose: Pose; label: string }[] = [
  { re: /\bsit( down)?\b|\btake a seat\b/, pose: 'sitting', label: 'sit down' },
  { re: /\bstand( up)?\b|\bget up\b/, pose: 'standing', label: 'stand up' },
  { re: /\bcrouch\b|\bsquat\b/, pose: 'crouching', label: 'crouch' },
  { re: /\blean\b(?! (your head )?forward)/, pose: 'leaning', label: 'lean' },
  { re: /\brest\b|\brelax\b/, pose: 'resting', label: 'relax' },
  { re: /\breach\b/, pose: 'reaching', label: 'reach out' },
];
const EXPR_CMDS: [RegExp, string][] = [
  [/\b(look|be|act) (happy|cheerful)\b|\bsmile\b/, 'happy'], [/\b(look|be|act) curious\b/, 'curious'], [/\b(look|be|act) surprised\b/, 'surprised'],
  [/\b(look|be|act) confused\b/, 'confused'], [/\b(look|be|act) (sad|concerned|worried)\b/, 'concerned'], [/\b(look|be|act) determined\b/, 'determined'],
  [/\bwink\b|\b(look|be|act) playful\b/, 'playful'], [/\b(look|be|act) (sleepy|tired)\b/, 'resting'],
];
function hash(s: string) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function mods(t: string) {
  const o: { speed?: number; amplitude?: number } = {};
  if (/\b(slow(ly)?|gentl[ey]|calm(ly)?)\b/.test(t)) { o.speed = 0.7; o.amplitude = 0.8; }
  if (/\b(fast|quick(ly)?)\b/.test(t)) o.speed = 1.4;
  if (/\b(big|bigger|huge|enthusiastic(ally)?)\b/.test(t)) o.amplitude = 1.2;
  if (/\b(small|subtle|tiny|little)\b/.test(t)) o.amplitude = 0.6;
  return o;
}
const learned = (t: string, req: ChatRequest) => req.skills.find((s) => !s.tags.includes('builtin') && (t.includes(s.id) || t.includes(s.id.replace(/_/g, ' ')) || (s.name.length > 3 && t.includes(s.name.toLowerCase()))))?.id ?? null;

export function demoBrain(req: ChatRequest, sources: Source[] = []): BrainResponse {
  const raw = req.messages.at(-1)!.content.trim();
  const t = raw.toLowerCase().replace(/[’']/g, "'");
  const known = new Set(req.skills.map((s) => s.id));
  const last = req.lastSkillId;

  // research results (extractive only — the demo brain cannot summarize)
  if (req.research) {
    if (!sources.length) return R({ reply: "I couldn't retrieve any sources for that (research is unavailable or returned nothing), and in demo mode I can't answer from knowledge either.", expression: 'concerned', uncertainty: 'high' });
    const lines = sources.slice(0, 3).map((s) => `[${s.id}] ${s.title}: ${s.snippet.split(/(?<=\.)\s/).slice(0, 2).join(' ')}`);
    return R({ reply: `Here is what I retrieved just now (quoted from the sources, not an AI summary — demo mode can't analyse it):\n${lines.join('\n')}`, expression: 'curious', citations: sources.slice(0, 3).map((s) => s.id), uncertainty: 'medium' });
  }

  // invention: new motion or expression
  if (/\b(invent|create|make up|come up with|design|generate|learn|teach yourself)\b/.test(t)) {
    if (/\b(expression|face|look)\b/.test(t)) {
      const e = inventExpression(hash(raw + req.messages.length), known);
      return R({ reply: `I mixed a new expression, "${e.name}", from my existing face parameters. It will be validated and shown as a preview — it only joins my library if you approve it.`, expression: 'playful', skillProposal: { format: 'expression', expression: e, reason: 'user asked for a new expression' } });
    }
    const theme = /danc|groove/.test(t) ? 'dance' : /celebrat|victory/.test(t) ? 'celebration' : /greet|hello|\bhi\b|welcome/.test(t) ? 'greeting' : 'gesture';
    const spec = inventSpec(theme, hash(raw + req.messages.length + known.size), known);
    return R({ reply: `I composed a new ${theme} from motion motifs: ${spec.motifs.map((m) => m.motif.replace(/_/g, ' ')).join(' → ')}. The validator will simulate it first; then you can preview it and decide whether to approve it.`, expression: 'determined', skillProposal: { format: 'generator', spec, reason: `user asked for a new ${theme}` } });
  }

  // gesture preference
  if (/\b(use|do)\b.*\b(when|whenever|to|for)\b.*\b(greet|hello|say hi|meet|bye|goodbye|agree|celebrat)/.test(t) && /\buse\b|\bfrom now on\b|\balways\b/.test(t)) {
    const context = /bye|goodbye/.test(t) ? 'farewell' : /agree/.test(t) ? 'agreement' : /celebrat/.test(t) ? 'celebration' : 'greeting';
    const stripped = t.replace(/\b(this|that|the|your|a) (gesture|move|motion)\b/g, ' ').replace(/\bgreet(ing)?\b/g, ' ');
    const named = learned(stripped, req) ?? COMMANDS.find((c) => c.re.test(stripped) && known.has(c.id))?.id;
    if (!named && !last) return R({ reply: "I haven't performed a gesture yet this session — show me one first, then tell me to use it.", expression: 'concerned', clarification: 'Which gesture should I use?' });
    return R({ reply: `Okay — I'll use ${named ? `"${named}"` : 'that gesture'} for ${context}s from now on (saved as a preference only if memory is on).`, expression: 'happy', preferenceUpdate: { context, skillId: named ?? 'last' }, actions: [{ type: 'skill', skillId: 'nod', timing: 'with_speech', repetitions: 1 }] });
  }

  // refinement feedback
  const target = learned(t, req) ?? COMMANDS.find((c) => c.re.test(t))?.id ?? 'last';
  const fb = /\btoo fast\b|\bslower\b|\bslow (it )?down\b/.test(t) ? { speedFactor: 0.7, note: 'slower' }
    : /\btoo slow\b|\bfaster\b|\bspeed (it )?up\b/.test(t) ? { speedFactor: 1.35, note: 'faster' }
    : /\bmore (casual(ly)?|relaxed)\b|\bless formal\b/.test(t) ? { speedFactor: 0.8, amplitudeFactor: 0.75, note: 'more casual' }
    : /\bmore subtle\b|\bsubtler\b|\bsmaller\b|\btone (it )?down\b|\btoo (big|much)\b/.test(t) ? { amplitudeFactor: 0.7, note: 'more subtle' }
    : /\bbigger\b|\bmore (energetic|enthusiastic)\b|\btoo (small|subtle)\b/.test(t) ? { amplitudeFactor: 1.25, note: 'bigger' } : null;
  if (fb && (target !== 'last' || last)) {
    const id = target === 'last' ? last! : target;
    return R({ reply: `Got it — I'll make my ${id.replace(/_/g, ' ')} ${fb.note}. That creates a new version (the current one stays available for rollback).`, expression: 'determined', skillRefinement: { skillId: id, speedFactor: fb.speedFactor, amplitudeFactor: fb.amplitudeFactor, note: `feedback: "${raw.slice(0, 120)}"` } });
  }
  if (/\b(looked|was|felt|seems?) (unnatural|weird|wrong|bad|off|awkward)\b/.test(t) && last) {
    return R({ reply: `Thanks — I logged a thumbs-down for "${last}". Was it too fast, too big, or too small? I can only adjust what I can measure.`, expression: 'concerned', clarification: 'Too fast, too big, or too small?', feedback: { skillId: last, rating: 'down', note: raw.slice(0, 200) } });
  }
  if (/\b(that was|looks?|looked) (great|good|nice|perfect|cute|awesome)\b|\bi (like|love)d? (it|that)\b/.test(t) && last) {
    return R({ reply: `Thank you! I recorded a thumbs-up for "${last}".`, expression: 'happy', feedback: { skillId: last, rating: 'up', note: raw.slice(0, 200) }, actions: [{ type: 'skill', skillId: 'nod', timing: 'with_speech' }] });
  }

  // explicit memory request (this is the user's consent)
  const rem = /^(please )?(remember|note|keep in mind)( that)? (.{3,180})$/i.exec(raw);
  if (rem) {
    const fact = rem[4].replace(/[.!]+$/, '');
    const km = /\bmy ([a-z ]{3,30}?) (is|are)\b/i.exec(fact);
    const key = km ? km[1].trim().toLowerCase().replace(/\s+/g, '_').slice(0, 40) : undefined;
    return R({ reply: `I'll ask the memory system to save: "${fact}". You can review or delete it in the Memory panel.`, expression: 'happy', memoryCandidates: [{ text: fact, category: /prefer|like|love|hate|favou?rite/i.test(fact) ? 'preference' : 'fact', key, reason: 'you asked me to remember this', explicit: true }], actions: [{ type: 'skill', skillId: 'nod', timing: 'with_speech', repetitions: 1 }] });
  }

  // commands: movements, poses, expressions, chained with "then", negation-aware
  const clauses = t.split(/\bthen\b|\band then\b|,|;|\band\b|\bafter that\b/).map((c) => c.trim()).filter(Boolean);
  const actions: ActionStep[] = []; const said: string[] = []; const refused: string[] = [];
  let pose: Pose = 'neutral'; let expression = 'happy';
  for (const c of clauses) {
    const l = learned(c, req);
    if (l && /\b(do|perform|show|try|play)\b/.test(c)) { actions.push({ type: 'skill', skillId: l, timing: 'after_speech' }); said.push(`perform "${l}"`); continue; }
    const p = POSE_CMDS.find((x) => x.re.test(c));
    if (p && !NEG.test(c)) { pose = p.pose; said.push(p.label); continue; }
    const e = EXPR_CMDS.find(([re]) => re.test(c));
    if (e && !NEG.test(c)) { expression = e[1]; said.push(`look ${e[1]}`); continue; }
    const cmd = COMMANDS.find((x) => x.re.test(c));
    if (!cmd) {
      if (/\b(backflip|fly|cartwheel|pick up|grab|dance)\b/.test(c)) {
        const what = /\b(backflip|fly|cartwheel|pick up|grab|dance)\b/.exec(c)![1];
        if (what !== 'dance') actions.push({ type: 'unsupported', request: what, reason: 'my 2D rig has no physics, props or flips' });
        else { actions.push({ type: 'skill', skillId: known.has('dance_1') ? 'dance_1' : 'bounce', timing: 'after_speech' }); said.push(known.has('dance_1') ? 'dance' : 'bounce (I have no dance yet — ask me to invent one!)'); }
      }
      continue;
    }
    if (NEG.test(c)) { refused.push(cmd.label); continue; }
    const side = /\bleft (hand|arm)\b/.test(c) ? 'left' as const : undefined;
    actions.push({ type: 'skill', skillId: cmd.id, timing: 'after_speech', ...mods(c), ...(num(c) ? { repetitions: Math.min(4, num(c)!) } : {}), ...(side ? { side } : {}) });
    said.push(cmd.label);
  }
  const unsupported = actions.filter((a) => a.type === 'unsupported') as Extract<ActionStep, { type: 'unsupported' }>[];
  if (said.length || refused.length || unsupported.length) {
    const first = actions.find((a) => a.type === 'skill'); if (first && first.type === 'skill') first.timing = actions.filter((a) => a.type === 'skill').length === 1 ? 'with_speech' : 'before_speech';
    const list = said.length > 1 ? `${said.slice(0, -1).join(', ')} and then ${said.at(-1)}` : said[0];
    const reply = [said.length ? `Sure — I'll ${list}.` : '', refused.length ? `Okay, I won't ${refused.join(' or ')}.` : '', unsupported.length ? `I can't ${unsupported.map((u) => u.request).join(' or ')}: ${unsupported[0].reason}.` : ''].filter(Boolean).join(' ');
    return R({ reply, expression, pose, actions, speakingStyle: 'warm' });
  }

  if (/^(hi|hello|hey|yo|hiya|namaste|good (morning|afternoon|evening))\b/.test(t))
    return R({ reply: `Hi! I'm ${req.profile.robotName}. Right now I'm running on my demo brain, so I can move, emote, learn approved gestures and remember things you ask me to — real conversation needs a language model configured on the server.`, expression: 'happy', gesture: 'greeting' });
  if (/\b(bye|goodbye|see you|good night)\b/.test(t)) return R({ reply: 'Bye for now!', expression: 'happy', gesture: 'farewell' });
  if (/\b(thanks|thank you|thx)\b/.test(t)) return R({ reply: "You're welcome!", expression: 'happy', actions: [{ type: 'skill', skillId: 'nod', timing: 'with_speech', repetitions: 1 }] });
  if (/what can you do|\bhelp\b|commands/.test(t))
    return R({ reply: 'Demo mode: ask me to wave, point, nod, shrug, clap, bounce, celebrate, walk, turn, sit, crouch, lean, look happy/curious/confused…, and chain them with "then". Say "invent a new greeting" or "invent a new expression" to try skill learning, give feedback like "that was too fast", or say "remember that …". Configure an LLM for open conversation.', expression: 'happy', actions: [{ type: 'skill', skillId: 'open_arms', timing: 'with_speech' }] });
  if (/what('s| is) your name|\byour name\??$/.test(t))
    return R({ reply: `My name is ${req.profile.robotName}.${req.profile.robotName === 'NEXUS' ? ' You can give me a different name with the pencil next to my name.' : ''}`, expression: 'happy', actions: [{ type: 'skill', skillId: 'nod', timing: 'with_speech', repetitions: 1 }] });
  if (/\b(are you|is this) (an? )?(ai|llm|real|smart|chatgpt|gpt)\b|\bwho are you\b/.test(t))
    return R({ reply: `Honest answer: right now you're talking to ${req.profile.robotName}'s scripted demo brain, not a language model. When an LLM is configured on the server, my replies come from it.`, expression: 'determined', actions: [{ type: 'skill', skillId: 'shrug', timing: 'with_speech' }] });
  return R({ reply: "I'm in demo mode without a language model, so I can't genuinely answer that. I can still move, emote and learn gestures — try \"wave then nod\" or \"invent a new greeting\". To chat about anything, configure an LLM in Settings → Model or the server's .env.", expression: 'concerned', uncertainty: 'high', actions: [{ type: 'skill', skillId: 'shrug', timing: 'with_speech' }] });
}
