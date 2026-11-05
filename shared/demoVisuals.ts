/**
 * The demo brain's scripted mini-explanations with visuals — so the visual presenter can be tried (and tested)
 * without a language model. With Gemini the model writes the explanation and chooses the visual itself.
 * Only explicit "explain / what is / how does / tell me about / show me" requests get one.
 */
import type { VisualRequestInput } from './visual';

interface Topic { re: RegExp; reply: string; visual: VisualRequestInput; gesture?: string }
export const EXPLAIN_RE = /\b(explain|what (is|are|was|were)|what's|how (does|do|did)|tell me about|teach me|describe|show me|why (is|does|do))\b/;

export const DEMO_TOPICS: Topic[] = [
  { re: /\bsolar system\b|\bplanets\b/, gesture: 'explain',
    reply: 'The solar system is the Sun and everything that orbits it. As you can see on the right, eight planets circle the Sun — the four small rocky ones close in, then the gas and ice giants further out. (Demo mode: a scripted explanation, not an AI.)',
    visual: { kind: 'diagram', caption: 'The eight planets in order from the Sun (distances not to scale).', diagram: { type: 'orbit', title: 'The solar system', center: { label: 'Sun' }, items: ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'].map((label) => ({ label })) } } },
  { re: /\bneural net(work)?s?\b|\bdeep learning\b/, gesture: 'explain',
    reply: 'A neural network passes numbers through layers of simple units. Look at the diagram on the right: inputs on the left, hidden layers in the middle that each combine the layer before, and an output on the right. Training adjusts the strength of every connection. (Demo mode: a scripted explanation, not an AI.)',
    visual: { kind: 'diagram', caption: 'Every unit connects to every unit in the next layer.', diagram: { type: 'network', title: 'A small neural network', layers: [{ label: 'Input', size: 3 }, { label: 'Hidden', size: 5 }, { label: 'Hidden', size: 4 }, { label: 'Output', size: 2 }] } } },
  { re: /\bgravity\b|\bgravitation/, gesture: 'explain',
    reply: 'Gravity is the attraction between masses. On the right, the Earth pulls the apple toward its centre — and the apple pulls the Earth back just as hard, it simply moves far less. (Demo mode: a scripted explanation, not an AI.)',
    visual: { kind: 'diagram', caption: 'Equal and opposite pull; the bigger mass barely moves.', diagram: { type: 'forces', title: 'Gravity', body: { label: 'Apple' }, attractor: { label: 'Earth' }, forces: [{ label: 'Weight (pull of the Earth)', direction: 'toward', strength: 0.9 }] } } },
  { re: /\bwater cycle\b/, gesture: 'explain',
    reply: 'Water keeps moving in a loop. Follow the cycle on the right: the Sun evaporates water, the vapour condenses into clouds, it falls as rain or snow, and it collects in rivers and oceans to start again. (Demo mode: a scripted explanation, not an AI.)',
    visual: { kind: 'diagram', caption: 'The same water goes round and round.', diagram: { type: 'cycle', title: 'The water cycle', steps: [{ label: 'Evaporation' }, { label: 'Condensation' }, { label: 'Precipitation' }, { label: 'Collection' }] } } },
  { re: /\bphotosynthesis\b/, gesture: 'explain',
    reply: 'Photosynthesis is how plants make food from light. The steps are on the right: leaves take in light, water and carbon dioxide, and turn them into sugar, releasing oxygen. (Demo mode: a scripted explanation, not an AI.)',
    visual: { kind: 'diagram', caption: 'Light energy is stored as sugar.', diagram: { type: 'flow', title: 'Photosynthesis', steps: [{ label: 'Light', note: 'absorbed by chlorophyll' }, { label: 'Water + CO₂', note: 'from roots and air' }, { label: 'Sugar', note: 'stored energy' }, { label: 'Oxygen', note: 'released' }] } } },
  { re: /\bweather\b.*\bclimate\b|\bclimate\b.*\bweather\b/, gesture: 'compare',
    reply: 'On one hand, weather is what the atmosphere does today; on the other, climate is the long-term average over decades. The comparison is on the right. (Demo mode: a scripted explanation, not an AI.)',
    visual: { kind: 'diagram', caption: 'Weather is short-term; climate is the long-term pattern.', diagram: { type: 'compare', title: 'Weather vs climate', left: { title: 'Weather', points: ['Hours to days', 'Changes quickly', 'Local'] }, right: { title: 'Climate', points: ['Decades', 'Changes slowly', 'Regional to global'] } } } },
  { re: /\bmoon landing\b|\bapollo 11\b/, gesture: 'explain',
    reply: 'In July 1969 Apollo 11 landed the first people on the Moon. The photo on the right is from that mission. (Demo mode: a scripted explanation, not an AI.)',
    visual: { kind: 'image', query: 'Apollo 11', caption: 'Apollo 11, July 1969.' } },
  { re: /\btaj mahal\b/, gesture: 'explain',
    reply: 'The Taj Mahal in Agra is a white marble mausoleum built in the 17th century by the Mughal emperor Shah Jahan. There is a photo on the right. (Demo mode: a scripted explanation, not an AI.)',
    visual: { kind: 'image', query: 'Taj Mahal', caption: 'The Taj Mahal, Agra.' } },
];

export function demoTopic(t: string): Topic | null {
  if (!EXPLAIN_RE.test(t)) return null;
  return DEMO_TOPICS.find((x) => x.re.test(t)) ?? null;
}
