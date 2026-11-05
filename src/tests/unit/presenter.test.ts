/**
 * [A145] Visual presenter: what the model may ask to show (validated), the free credited image search, the diagram
 * renderer, the demo topics, the prompt contract, and the presenter body language (gestures, speech envelope).
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { BrainHeadSchema, BrainResponseSchema, ChatRequestSchema } from '../../../shared/schema';
import { DIAGRAM_TYPES, DiagramSchema, VisualRequestSchema, isAllowedImageUrl, plainText, type Diagram } from '../../../shared/visual';
import { findImage } from '../../../shared/imageSearch';
import { demoBrain } from '../../../shared/demoBrain';
import { DiagramView, wrap } from '../../visual/DiagramView';
import { buildSystemPrompt, PROMPT_VERSION } from '../../../server/prompts/system';
import { coerceBrainResponse } from '../../../server/brainService';
import { BodyController, CLIP_FOR_SKILL } from '../../character3d/body/controller';
import { CLIP_BY_ID, STATE_CLIP } from '../../character3d/body/clips';
import { analyzeClip } from '../../character3d/body/checks';
import { ClipSampler } from '../../character3d/body/clip';
import { fk } from '../../character3d/body/skeleton';
import { bodyStateFor } from '../../core/characterRuntime';
import { BUILTIN_MOTIONS } from '../../animation/builtinMotions';

export const SAMPLE_DIAGRAMS: Diagram[] = [
  { type: 'orbit', title: 'Solar system', center: { label: 'Sun' }, items: ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'].map((label) => ({ label })) },
  { type: 'network', title: 'Neural network', layers: [{ label: 'Input', size: 3 }, { label: 'Hidden', size: 5 }, { label: 'Output', size: 2 }] },
  { type: 'flow', title: 'Photosynthesis', steps: [{ label: 'Light', note: 'absorbed' }, { label: 'Sugar' }, { label: 'Oxygen' }] },
  { type: 'cycle', title: 'Water cycle', steps: [{ label: 'Evaporation' }, { label: 'Condensation' }, { label: 'Precipitation' }, { label: 'Collection' }] },
  { type: 'compare', title: 'Weather vs climate', left: { title: 'Weather', points: ['Days'] }, right: { title: 'Climate', points: ['Decades'] } },
  { type: 'timeline', title: 'Space race', events: [{ date: '1957', label: 'Sputnik' }, { date: '1961', label: 'Gagarin' }, { date: '1969', label: 'Apollo 11' }] },
  { type: 'forces', title: 'Gravity', body: { label: 'Apple' }, attractor: { label: 'Earth' }, forces: [{ label: 'Weight', direction: 'toward', strength: 0.9 }] },
  { type: 'hierarchy', title: 'Vertebrates', root: 'Vertebrates', children: [{ label: 'Mammals', children: ['Dogs', 'Whales'] }, { label: 'Birds', children: [] }] },
  { type: 'bars', title: 'Planet diameters', unit: 'km', items: [{ label: 'Earth', value: 12742 }, { label: 'Jupiter', value: 139820 }] },
];

/** a tiny fake of the MediaWiki API */
function fakeWiki(o: { pages?: unknown[]; meta?: unknown; fail?: 'search' | 'meta'; status?: number } = {}) {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url); const u = new URL(url);
    if (u.searchParams.get('generator') === 'search') {
      if (o.fail === 'search') return new Response('err', { status: o.status ?? 503 });
      return Response.json({ query: { pages: o.pages ?? [
        { pageid: 2, index: 2, title: 'Second', pageimage: 'B.jpg', thumbnail: { source: 'https://upload.wikimedia.org/b.jpg', width: 960, height: 600 }, fullurl: 'https://en.wikipedia.org/wiki/Second' },
        { pageid: 1, index: 1, title: 'Taj Mahal', pageimage: 'Taj.jpg', thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/taj.jpg/960px-taj.jpg', width: 960, height: 640 }, fullurl: 'https://en.wikipedia.org/wiki/Taj_Mahal' },
      ] } });
    }
    if (o.fail === 'meta') throw new Error('network down');
    return Response.json(o.meta ?? { query: { pages: [{ imageinfo: [{ descriptionurl: 'https://commons.wikimedia.org/wiki/File:Taj.jpg', extmetadata: { Artist: { value: '<a href="//x">Yann</a> Forget' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' } } }] }] } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('[A145] visual presenter — what can be shown', () => {
  it('[A145] the model\'s visual is validated: every diagram type parses; an invalid visual becomes null and the rest of the head survives', () => {
    for (const d of SAMPLE_DIAGRAMS) expect(DiagramSchema.safeParse(d).success, d.type).toBe(true);
    expect(new Set(SAMPLE_DIAGRAMS.map((d) => d.type))).toEqual(new Set(DIAGRAM_TYPES));
    const good = BrainHeadSchema.parse({ expression: 'interested', visual: { kind: 'image', query: 'Taj Mahal' } });
    expect(good.visual).toEqual({ kind: 'image', query: 'Taj Mahal', caption: '' });
    const bad = BrainHeadSchema.parse({ expression: 'interested', gesture: 'explain', visual: { kind: 'diagram', diagram: { type: 'orbit', title: 'x', items: [] } } });
    expect(bad.visual).toBeNull(); expect(bad.expression).toBe('interested'); expect(bad.gesture).toBe('explain');
    expect(BrainHeadSchema.parse({ visual: { kind: 'html', html: '<script>' } }).visual).toBeNull();
    expect(BrainResponseSchema.parse({ reply: 'hi' }).visual).toBeNull();                 // most replies have none
    // the server's coercion keeps the field (part of the contract); a visual with unknown extras is rejected → null, the reply stays
    const c = coerceBrainResponse({ reply: 'Look right.', visual: { kind: 'image', query: 'Apollo 11', caption: 'Moon', extra: 1 } });
    expect(c.value?.reply).toBe('Look right.'); expect(c.value?.visual).toBeNull(); expect(c.dropped).toEqual([]);
    expect(VisualRequestSchema.safeParse({ kind: 'image', query: 'x' }).success).toBe(false);   // too short to search
  });

  it('[A145] only https images from Wikimedia\'s image host are ever shown; credit text is plain text', () => {
    expect(isAllowedImageUrl('https://upload.wikimedia.org/a.jpg')).toBe(true);
    for (const u of ['http://upload.wikimedia.org/a.jpg', 'https://evil.example/a.jpg', 'javascript:alert(1)', 'https://upload.wikimedia.org.evil.com/a.jpg']) expect(isAllowedImageUrl(u), u).toBe(false);
    expect(plainText('<a href="x">Jane</a> &amp; <b>Joe</b>')).toBe('Jane & Joe');
  });
});

describe('[A145] internet image retrieval (Wikipedia / Wikimedia Commons, free, no key)', () => {
  it('[A145] finds the best-ranked article image with a free licence and credits its author, licence and source pages', async () => {
    const w = fakeWiki(); const r = await findImage('taj mahal', { fetch: w.f });
    expect(r).toMatchObject({ title: 'Taj Mahal', url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/taj.jpg/960px-taj.jpg', author: 'Yann Forget', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0', fileUrl: 'https://commons.wikimedia.org/wiki/File:Taj.jpg', pageUrl: 'https://en.wikipedia.org/wiki/Taj_Mahal', source: 'Wikimedia Commons' });
    expect(w.calls[0]).toContain('pilicense=free'); expect(w.calls[0]).toContain('origin=*');
  });
  it('[A145] fails gracefully: no hit, a non-Wikimedia image, a broken licence lookup or an HTTP error never break the reply', async () => {
    expect(await findImage('nothing', { fetch: fakeWiki({ pages: [] }).f })).toBeNull();
    expect(await findImage('elsewhere', { fetch: fakeWiki({ pages: [{ pageid: 1, index: 1, title: 'X', pageimage: 'x.jpg', thumbnail: { source: 'https://evil.example/x.jpg', width: 1, height: 1 } }] }).f })).toBeNull();
    const noMeta = await findImage('taj mahal', { fetch: fakeWiki({ fail: 'meta' }).f });
    expect(noMeta?.license).toBe('See source'); expect(noMeta?.author).toBe('Unknown'); expect(noMeta?.fileUrl).toContain('commons.wikimedia.org/wiki/File:');
    await expect(findImage('taj', { fetch: fakeWiki({ fail: 'search' }).f })).rejects.toThrow(/HTTP 503/);   // the server/client turn this into {image:null}
    expect(await findImage(' ', { fetch: fakeWiki().f })).toBeNull();
  });
});

describe('[A145] AI-generated diagrams (validated data drawn by the app as SVG)', () => {
  it('[A145] every diagram type renders an accessible SVG with its labels; labels are text, never markup', () => {
    for (const d of SAMPLE_DIAGRAMS) {
      const html = renderToStaticMarkup(createElement(DiagramView, { diagram: d }));
      expect(html, d.type).toMatch(/^<svg[^>]*role="img"/); expect(html).toContain(`data-diagram="${d.type}"`); expect(html).toContain(`<title>${d.title}</title>`);
    }
    expect(renderToStaticMarkup(createElement(DiagramView, { diagram: SAMPLE_DIAGRAMS[0] }))).toContain('Neptune');
    const evil = renderToStaticMarkup(createElement(DiagramView, { diagram: { type: 'flow', title: '<script>alert(1)</script>', steps: [{ label: '<img src=x onerror=alert(1)>' }, { label: 'ok' }] } }));
    expect(evil).not.toContain('<script>'); expect(evil).not.toContain('<img'); expect(evil).toContain('&lt;');
    expect(wrap('Precipitation and collection of water', 14, 2)).toEqual(['Precipitation', 'and collection…']);
  });
});

describe('[A145] when a visual is shown (not on every reply)', () => {
  const req = (text: string) => ChatRequestSchema.parse({ messages: [{ role: 'user', content: text }], skills: BUILTIN_MOTIONS.map((m) => ({ id: m.id, name: m.name, description: m.description.slice(0, 200), kind: m.kind, tags: m.tags.slice(0, 12) })) });
  it('[A145] demo topics: explanation requests get a fitting diagram or photo and a presenter gesture; chit-chat and commands get none', () => {
    const v = (t: string) => demoBrain(req(t)).visual;
    expect(v('Explain the solar system')).toMatchObject({ kind: 'diagram', diagram: { type: 'orbit', center: { label: 'Sun' } } });
    expect(v('how does a neural network work?')).toMatchObject({ kind: 'diagram', diagram: { type: 'network' } });
    expect(v('what is gravity')).toMatchObject({ kind: 'diagram', diagram: { type: 'forces' } });
    expect(v('tell me about the Apollo 11 moon landing')).toMatchObject({ kind: 'image', query: 'Apollo 11' });
    expect(v('what is the difference between weather and climate')).toMatchObject({ kind: 'diagram', diagram: { type: 'compare' } });
    for (const t of ['hello', 'tell me a joke', 'do a backflip', 'thanks', 'the planets are pretty']) expect(v(t), t).toBeNull();
    expect(demoBrain(req('explain the water cycle')).actions).toEqual([expect.objectContaining({ skillId: 'explain' })]);
    expect(demoBrain(req('explain the solar system')).reply).toMatch(/on the right/);
  });
  it('[A145] the AI is told when (and when not) to show a visual, in its HEAD line, with the exact diagram shapes', () => {
    const p = buildSystemPrompt(req('explain gravity'), { streaming: true, sources: [] });
    expect(p).toContain('VISUAL (optional, in HEAD as "visual")'); expect(p).toMatch(/Use null for greetings, chit-chat/); expect(p).toMatch(/Never show a visual just to decorate/);
    for (const t of DIAGRAM_TYPES) expect(p).toContain(`"type":"${t}"`);
    expect(p).toContain('"visual"}'); expect(p).toMatch(/point_right/); expect(PROMPT_VERSION).toMatch(/presenter/);
    expect(buildSystemPrompt(req('x'), { streaming: false, sources: [] })).toContain('speakingStyle, visual, actions');
  });
});

describe('[A145] presenter body language', () => {
  it('[A145] presenter gestures are clean clips: point right uses the arm on the panel\'s side, compare alternates, explaining loops', () => {
    for (const id of ['point_right', 'point_left', 'compare', 'explain', 'state_thinking']) expect(analyzeClip(CLIP_BY_ID[id]).ok, id).toBe(true);
    const palmX = (id: string, t: number, s: 'L' | 'R') => fk(new ClipSampler(CLIP_BY_ID[id]).sample(t)).arm[s].palm[0];
    expect(palmX('point_right', 0.9, 'L')).toBeGreaterThan(0.8);      // +x = the robot's left = the viewer's right, where the panel is
    expect(palmX('point_left', 0.9, 'R')).toBeLessThan(-0.8);
    expect(palmX('compare', 0.9, 'R')).toBeLessThan(palmX('compare', 2.2, 'R'));   // first one side, then the other
    expect(palmX('compare', 2.2, 'L')).toBeGreaterThan(palmX('compare', 0.9, 'L'));
    expect(CLIP_BY_ID.explain.loop).toBeTruthy(); expect(CLIP_BY_ID.explain.mask).toBe('arms');
    for (const s of ['point_right', 'point_left', 'compare', 'explain']) { expect(CLIP_FOR_SKILL[s]).toBe(s); expect(BUILTIN_MOTIONS.some((m) => m.id === s && !m.tracks.some((t) => t.channel.startsWith('mouth.')))).toBe(true); }
  });
  it('[A145] states: explaining → EXPLAINING (presenter hands); thinking is subtle head movement only', () => {
    expect(bodyStateFor('explaining', null)).toBe('EXPLAINING'); expect(STATE_CLIP.EXPLAINING).toBe('explain');
    expect(STATE_CLIP.THINKING).toBe('state_thinking'); expect(CLIP_BY_ID.state_thinking.mask).toBe('head');
    expect(analyzeClip(CLIP_BY_ID.state_thinking).maxSpeed).toBeLessThan(1);
  });
  it('[A145] gestures follow the voice: arms relax in pauses, the head nods on stressed syllables, and everything settles once speech ends', () => {
    const b = new BodyController(); b.setState('EXPLAINING');
    const weight = () => b.update(1 / 60).layers.reduce((a, l) => Math.max(a, l.w.Arm_R), 0);
    for (let i = 0; i < 60; i++) b.update(1 / 60);                               // fade in, silent
    const silent = weight();
    let maxAccent = 0, loud = 0;
    for (let i = 0; i < 120; i++) { b.setSpeech(i % 12 < 6 ? 0.8 : 0.05); const o = b.update(1 / 60); maxAccent = Math.max(maxAccent, o.accent); loud = Math.max(loud, o.layers.reduce((a, l) => Math.max(a, l.w.Arm_R), 0)); }
    expect(silent).toBeLessThan(0.5); expect(loud).toBeGreaterThan(silent + 0.3); expect(maxAccent).toBeGreaterThan(0.01); expect(maxAccent).toBeLessThanOrEqual(0.07);
    b.setSpeech(0); for (let i = 0; i < 90; i++) b.update(1 / 60);
    const after = b.update(1 / 60); expect(after.accent).toBe(0); expect(after.speech).toBeLessThan(0.05);
    b.setState('IDLE'); for (let i = 0; i < 60; i++) b.update(1 / 60); expect(b.update(1 / 60).active).toBe(false);   // back to neutral
    const r = new BodyController(); r.reduced = true; r.setState('SPEAKING'); for (let i = 0; i < 60; i++) { r.setSpeech(i % 10 < 5 ? 1 : 0); expect(r.update(1 / 60).accent).toBe(0); }
  });
});
