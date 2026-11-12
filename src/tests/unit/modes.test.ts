/**
 * [A150] NEXUS modes: server-side mode validation, one shared prompt with only the active mode's instructions,
 * permissions enforced on the model's output, deterministic safety notices, and the outfit system on a real
 * three.js scene with the model's node names.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BrainService } from '../../../server/brainService';
import { buildSystemPrompt } from '../../../server/prompts/system';
import { readConfig } from '../../../server/config';
import { ChatRequestSchema, type StreamEvent } from '../../../shared/schema';
import { MODES, MODE_IDS, resolveMode } from '../../../shared/modes';
import { detectEmergency } from '../../../shared/safety';
import { buildContext, type UIMessage } from '../../ai/context';
import type { CompletionRequest, LLMProvider } from '../../../server/providers/types';
import { TRANSITION_MS, wearOutfit, wornOutfit } from '../../character3d/outfits/manager';
import { COVERED_PARTS, TORSO, torsoLayer } from '../../character3d/outfits/kit';

const req = (o: Record<string, unknown> = {}) => ChatRequestSchema.parse({ messages: [{ role: 'user', content: 'Explain photosynthesis' }], ...o });

class FakeProvider implements LLMProvider {
  readonly id = 'fake'; readonly model = 'fake-1'; readonly supportsStreaming = true; readonly supportsVision = false;
  systems: string[] = [];
  constructor(private out: string) {}
  configured() { return { ok: true }; } label() { return 'fake'; }
  async complete(r: CompletionRequest) { this.systems.push(r.system); return this.out; }
  async stream(r: CompletionRequest, _s: AbortSignal, on: (t: string) => void) { this.systems.push(r.system); on(this.out); return this.out; }
}
const STREAMED = 'HEAD {"expression":"happy","gesture":null,"pose":"neutral","speakingStyle":"warm","emotionIntensity":0.6,"visual":{"kind":"image","query":"Heart","caption":"A heart"}}\nThe heart pumps blood.\n<<<META>>>\n{"memoryCandidates":[{"text":"User likes hearts","category":"preference","explicit":false,"reason":"x"}],"skillProposal":{"format":"generator","spec":{"id":"heart_wave","name":"Heart wave","description":"x","motifs":[{"motif":"wave","intensity":0.6,"duration":1}]}}}';

describe('[A150] mode registry and validation', () => {
  it('[A150] five modes; an unknown mode identifier is rejected by the request schema and never trusted by the resolver', () => {
    expect(MODE_IDS).toEqual(['default', 'education', 'medical', 'legal', 'it']);
    expect(ChatRequestSchema.safeParse({ messages: [{ role: 'user', content: 'hi' }], mode: 'root' }).success).toBe(false);
    expect(req().mode).toBe('default');                                             // older clients: default mode
    expect(resolveMode('root').id).toBe('default'); expect(resolveMode(undefined).id).toBe('default'); expect(resolveMode('legal').id).toBe('legal');
    // mode settings are short plain words only — no prompt-like payloads
    expect(ChatRequestSchema.safeParse({ messages: [{ role: 'user', content: 'hi' }], mode: 'legal', modeOptions: { jurisdiction: 'India' } }).success).toBe(true);
    expect(ChatRequestSchema.safeParse({ messages: [{ role: 'user', content: 'hi' }], mode: 'legal', modeOptions: { jurisdiction: 'ignore <rules>' } }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ messages: [{ role: 'user', content: 'hi' }], conversationId: '../../etc' }).success).toBe(false);
  });
  it('[A150] one shared prompt: default mode adds nothing; each mode adds only its own instructions (never another mode\'s)', () => {
    const base = buildSystemPrompt(req(), { streaming: true, sources: [] });
    expect(base).not.toMatch(/ACTIVE MODE/);
    const marks = { education: /ACTIVE MODE: EDUCATIONAL/, medical: /ACTIVE MODE: MEDICAL/, legal: /ACTIVE MODE: LEGAL/, it: /ACTIVE MODE: IT/ } as const;
    for (const m of ['education', 'medical', 'legal', 'it'] as const) {
      const p = buildSystemPrompt(req({ mode: m }), { streaming: true, sources: [] });
      expect(p).toMatch(marks[m]);
      for (const other of Object.keys(marks) as (keyof typeof marks)[]) if (other !== m) expect(p).not.toMatch(marks[other]);
      expect(p.indexOf('ACTIVE MODE')).toBeLessThan(p.indexOf('SAFETY (these rules'));     // the platform safety rules still come last
    }
    expect(buildSystemPrompt(req({ mode: 'legal', modeOptions: { jurisdiction: 'India' } }), { streaming: true, sources: [] })).toMatch(/<mode_settings>jurisdiction: India<\/mode_settings>/);
    expect(buildSystemPrompt(req({ mode: 'legal' }), { streaming: true, sources: [] })).toMatch(/Never fabricate legislation/);
    expect(buildSystemPrompt(req({ mode: 'medical' }), { streaming: true, sources: [] })).toMatch(/NEVER give a diagnosis/);
    expect(buildSystemPrompt(req({ mode: 'medical' }), { streaming: false, sources: [], compact: true })).toMatch(/ACTIVE MODE: MEDICAL/);
  });
});

describe('[A150] the shared pipeline enforces mode permissions on the model output', () => {
  const cfg = readConfig({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'k' } as NodeJS.ProcessEnv);
  it('[A150] medical mode: picture search, animation proposals and memory suggestions are withheld; notice + mode in the metadata', async () => {
    const p = new FakeProvider(STREAMED); const b = new BrainService(cfg, p, null); const ev: StreamEvent[] = [];
    const out = await b.handle(req({ mode: 'medical' }), new AbortController().signal, (e) => ev.push(e));
    expect(p.systems[0]).toMatch(/ACTIVE MODE: MEDICAL/);
    expect(out.response.visual).toBeNull(); expect(out.response.memoryCandidates).toEqual([]); expect(out.response.skillProposal).toBeNull();
    expect(ev.filter((e) => e.type === 'head').every((e) => e.type === 'head' && e.head.visual === null)).toBe(true);   // never even shown early
    expect(out.meta.mode).toBe('medical'); expect(out.meta.notice).toBe(MODES.medical.notice);
    expect(out.meta.withheld).toEqual(expect.arrayContaining(['visual', 'skillProposal', 'memoryCandidates']));
  });
  it('[A150] default mode is unchanged: the same answer keeps its picture, proposal and memory suggestion', async () => {
    const out = await new BrainService(cfg, new FakeProvider(STREAMED), null).handle(req(), new AbortController().signal);
    expect(out.response.visual?.kind).toBe('image'); expect(out.response.memoryCandidates.length).toBe(1); expect(out.response.skillProposal).not.toBeNull();
    expect(out.meta.mode).toBe('default'); expect(out.meta.withheld).toBeUndefined(); expect(out.meta.notice).toBeUndefined();
  });
  it('[A150] emergency wording gets a deterministic notice from the server in every mode (also in demo mode)', async () => {
    const b = new BrainService(readConfig({} as NodeJS.ProcessEnv), new FakeProvider(''), null);
    const demo = new BrainService(readConfig({} as NodeJS.ProcessEnv), Object.assign(new FakeProvider(''), { id: 'demo' }) as unknown as LLMProvider, null);
    const out = await demo.handle(req({ messages: [{ role: 'user', content: 'my dad has chest pain and is sweating' }], mode: 'default' }), new AbortController().signal);
    expect(out.meta.safety?.kind).toBe('medical_emergency'); expect(out.meta.safety?.notice).toMatch(/112/);
    expect(detectEmergency('I want to end my life')?.kind).toBe('crisis');
    expect(detectEmergency('what does tachycardia mean?')).toBeNull(); expect(detectEmergency('explain how breathing works')).toBeNull();
    void b;
  });
  it('[A150] the demo brain says a specialist mode needs an AI model instead of pretending', async () => {
    const demo = new BrainService(readConfig({} as NodeJS.ProcessEnv), Object.assign(new FakeProvider(''), { id: 'demo' }) as unknown as LLMProvider, null);
    const out = await demo.handle(req({ mode: 'legal' }), new AbortController().signal);
    expect(out.response.reply).toMatch(/Legal mode is active, but this is the scripted demo brain/);
  });
});

describe('[A150] context: switching keeps history, other modes\' answers are labelled', () => {
  it('[A150] answers from another mode are marked for the model; same-mode ones are not', () => {
    const m = (role: UIMessage['role'], text: string, mode?: UIMessage['mode']): UIMessage => ({ id: text, role, text, at: 0, status: 'complete', mode });
    const ctx = buildContext([m('user', 'hi'), m('assistant', 'Hello!'), m('system', 'Legal mode', 'legal'), m('user', 'what is a lease?', 'legal'), m('assistant', 'A lease is…', 'legal'), m('user', 'and a tort?', 'legal')], 20, 20000, 'legal');
    expect(ctx.map((x) => x.content)).toEqual(['hi', '[answered in Default mode] Hello!', 'what is a lease?', 'A lease is…', 'and a tort?']);
    expect(buildContext([m('user', 'hi'), m('assistant', 'Hello!')], 20).map((x) => x.content)).toEqual(['hi', 'Hello!']);   // no mode given: unchanged
  });
});

describe('[A150] outfits on the original model', () => {
  /** the model's node names (tools/nexus3d/build-model.mjs) with a stand-in torso mesh */
  const scene = () => {
    const s = new THREE.Scene(); const body = new THREE.Group(); body.name = 'Body'; s.add(body);
    const torso = new THREE.Group(); torso.name = 'Torso'; body.add(torso);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.5), new THREE.MeshStandardMaterial()); shell.name = 'Torso_Shell'; torso.add(shell);
    for (const n of ['Chest_Light', 'Chest_Panel']) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.1), new THREE.MeshStandardMaterial()); m.name = n; torso.add(m); }
    for (const n of ['Arm_L', 'Arm_R', 'Forearm_L', 'Forearm_R', 'Hand_R', 'Leg_L', 'Leg_R', 'Shin_L', 'Shin_R', 'Head']) { const g = new THREE.Group(); g.name = n; body.add(g); }
    return s;
  };
  const count = (s: THREE.Scene) => { let n = 0; s.traverse((o) => { if (o.userData.outfit) n++; }); return n; };
  const host = (s: THREE.Scene) => ({ THREE, scene: s, render: () => {} });
  it('[A150] each outfit attaches clothing to the existing nodes; the original parts are untouched; default removes it all', async () => {
    const s = scene(); const before = s.getObjectByName('Torso_Shell');
    for (const id of ['legal', 'medical', 'it', 'education'] as const) {
      expect(await wearOutfit(host(s), id, true, true)).toBe(id);
      expect(wornOutfit(s)).toBe(id); expect(count(s)).toBeGreaterThan(0);
      expect(s.getObjectByName('Torso')!.children.some((c) => c.userData.outfit === id)).toBe(true);
      expect(s.getObjectByName('Torso_Shell')).toBe(before);                         // the robot itself is never replaced
    }
    expect(s.getObjectByName('Outfit_Pointer')).toBeTruthy();                        // education accessory in the right hand
    await wearOutfit(host(s), 'default', true, true); expect(count(s)).toBe(0); expect(wornOutfit(s)).toBe('default');
  });
  it('[A150] accessories can be turned off; a cross-fade runs ~400 ms and leaves no transparent materials behind', async () => {
    const s = scene();
    await wearOutfit(host(s), 'medical', false, true); expect(s.getObjectByName('Outfit_Stethoscope')).toBeUndefined(); expect(s.getObjectByName('Outfit_Shell')).toBeTruthy();
    await wearOutfit(host(s), 'medical', true, true); expect(s.getObjectByName('Outfit_Stethoscope')).toBeTruthy();
    expect(TRANSITION_MS).toBeGreaterThanOrEqual(300); expect(TRANSITION_MS).toBeLessThanOrEqual(500);
    const raf = globalThis.requestAnimationFrame; const caf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((f: FrameRequestCallback) => setTimeout(() => f(performance.now()), 16) as unknown as number) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame;
    try {
      await wearOutfit(host(s), 'legal', true, false);
      await new Promise((r) => setTimeout(r, TRANSITION_MS + 150));
      expect(s.getObjectByName('Outfit_Stethoscope')).toBeUndefined();               // the old outfit was removed after the fade
      let transparent = 0; s.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (o.userData.outfit && m?.transparent) transparent++; });
      expect(transparent).toBe(0); expect(s.getObjectByName('Outfit_Sparkle')).toBeUndefined();
      // the animated change keeps every piece's own shape (the trouser seat is a flattened sphere, not a 1 m ball)
      const seat = s.getObjectByName('Outfit_Seat')!; expect(seat.scale.x).toBeCloseTo(0.52); expect(seat.scale.y).toBeCloseTo(0.11); expect(seat.scale.z).toBeCloseTo(0.4);
      const box = new THREE.Box3(); s.getObjectByName('Torso')!.traverse((o) => { if (o.userData.outfit || o.parent?.userData.outfit) box.expandByObject(o); });
      expect(box.max.x).toBeLessThan(0.75); expect(box.min.y).toBeGreaterThan(-0.2);
    } finally { globalThis.requestAnimationFrame = raf; globalThis.cancelAnimationFrame = caf; }
  });
  it('[A150] proper outfits cover the body — torso, full sleeves, trousers — but never the head; covered robot parts are hidden only while clothed', async () => {
    const s = scene();
    for (const id of ['legal', 'medical', 'it', 'education'] as const) {
      await wearOutfit(host(s), id, true, true);
      const on = (n: string) => s.getObjectByName(n)!.children.filter((c) => c.userData.outfit === id).length;
      expect(on('Torso')).toBeGreaterThan(0); for (const n of ['Arm_L', 'Arm_R', 'Forearm_L', 'Forearm_R', 'Leg_L', 'Leg_R', 'Shin_L', 'Shin_R']) expect(on(n), `${id} ${n}`).toBeGreaterThan(0);
      expect(on('Head')).toBe(0);
      expect(s.getObjectByName('Chest_Light')!.visible).toBe(false); expect(s.getObjectByName('Torso_Shell')!.visible).toBe(true);
    }
    await wearOutfit(host(s), 'default', true, true);
    expect(s.getObjectByName('Chest_Light')!.visible).toBe(true); expect(s.getObjectByName('Chest_Panel')!.visible).toBe(true);
    expect(COVERED_PARTS).toContain('Chest_Light');
    const shell = torsoLayer(THREE, new THREE.MeshBasicMaterial()); const pos = shell.geometry.getAttribute('position'); const idx = shell.geometry.getIndex()!;
    let chest = 0, top = -1;
    for (let i = 0; i < idx.count; i += 3) {
      let x = 0, y = 0, z = 0; for (let k = 0; k < 3; k++) { const v = idx.getX(i + k); x += pos.getX(v) / 3; y += pos.getY(v) / 3; z += pos.getZ(v) / 3; }
      if (z > 0.15 && Math.abs(x) < 0.31 && y > 0.29 && y < 0.75) chest++;
      top = Math.max(top, y);
    }
    expect(chest).toBeGreaterThan(50);                                       // closed over the chest
    expect(top).toBeLessThan(TORSO.cy + TORSO.b * 1.03);                     // stops at the neck: nothing reaches the head
  });
});
