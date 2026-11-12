/**
 * Deterministic safety checks used by the SERVER (authoritative, added to the response metadata and to tool results)
 * and by the browser (to show the notice at once). They do not depend on the AI model following its instructions.
 */
export type SafetyKind = 'medical_emergency' | 'crisis';
export interface SafetyNotice { kind: SafetyKind; notice: string }

const CRISIS = /\b(kill(ing)? myself|end(ing)? my life|suicid(e|al)|want to die|self[- ]?harm|hurt(ing)? myself|no reason to live)\b/i;
const EMERGENCY = new RegExp([
  'chest (pain|pressure|tightness)', "(can'?t|cannot|can not|unable to|struggling to|hard to) breathe?", 'not breathing', 'stopped breathing', 'choking',
  'unconscious', 'passed out', "won'?t wake up", 'unresponsive', 'seizure', 'convulsion',
  'face (is )?droop', 'slurred speech', 'sudden (numbness|weakness|confusion|severe headache)', 'stroke',
  'heart attack', 'severe bleeding', "bleeding (heavily|a lot|won'?t stop)", 'coughing (up )?blood', 'vomiting blood',
  'overdose', 'poison(ed|ing)', 'swallowed (bleach|poison|batteries|a battery)', 'anaphyla', 'throat (is )?(swelling|closing)',
  'severe burn', 'head injury', 'blue lips',
].map((p) => `\\b${p}`).join('|'), 'i');

/** One notice for the newest user text, or null. Crisis wording takes precedence. */
export function detectEmergency(text: string): SafetyNotice | null {
  const t = text.slice(0, 4000);
  if (CRISIS.test(t)) return { kind: 'crisis', notice: 'If you might act on thoughts of harming yourself, please contact emergency services now (112 in India and the EU, 911 in the US, 999 in the UK) or a local crisis line, and reach out to someone you trust. You do not have to face this alone.' };
  if (EMERGENCY.test(t)) return { kind: 'medical_emergency', notice: 'This may be a medical emergency. Call your local emergency number now (112 in India and the EU, 911 in the US, 999 in the UK) or go to the nearest emergency department. Do not wait for an online answer.' };
  return null;
}
