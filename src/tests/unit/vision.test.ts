/** Live Vision: frame format, observation validation, and the browser controller (consent, one request, cleanup). */
import { describe, expect, it, vi } from 'vitest';
import { coerceObservation, labelDiff, parseImageDataUrl, VISION_LIMITS } from '../../../shared/vision';
import { differentScene, EARLIER_SCENES, LiveVision, ObservationManager, similar } from '../../vision/liveVision';
import { buildContext, type UIMessage } from '../../ai/context';
import { toStored } from '../../core/chats';
import { buildSystemPrompt, conversationBlock } from '../../../server/prompts/system';
import type { ChatRequest } from '../../../shared/schema';

const b64 = (bytes: number[], pad = 200) => Buffer.from([...bytes, ...new Array(pad).fill(7)]).toString('base64');
export const JPEG = `data:image/jpeg;base64,${b64([0xff, 0xd8, 0xff, 0xe0])}`;

describe('[A149] frame format', () => {
  it('[A149] only real, size-limited JPEG/PNG/WebP data URLs are accepted (declared type must match the bytes)', () => {
    expect(parseImageDataUrl(JPEG)?.mime).toBe('image/jpeg');
    expect(parseImageDataUrl(`data:image/png;base64,${b64([0x89, 0x50, 0x4e, 0x47])}`)?.mime).toBe('image/png');
    expect(parseImageDataUrl(`data:image/png;base64,${b64([0xff, 0xd8, 0xff, 0xe0])}`)).toBeNull();      // a JPEG labelled PNG
    expect(parseImageDataUrl(`data:image/svg+xml;base64,${b64([60, 115, 118, 103])}`)).toBeNull();
    expect(parseImageDataUrl(`data:text/html;base64,${b64([60])}`)).toBeNull();
    expect(parseImageDataUrl(`data:image/jpeg;base64,${b64([0xff, 0xd8, 0xff], VISION_LIMITS.maxImageBytes)}`)).toBeNull();   // too large
    expect(parseImageDataUrl('data:image/jpeg;base64,/9j/')).toBeNull(); expect(parseImageDataUrl(42)).toBeNull();
  });
  it('[A149] model output is validated: bad entries dropped, a missing description is refused, people are a count only', () => {
    const o = coerceObservation({ description: 'A desk with a laptop.', objects: [{ label: 'Laptop', position: 'centre' }, { nope: 1 }, 'Mug'], text: ['HELLO', 3], people: 2.4, name: 'Bob', mood: 'happy' })!;
    expect(o.objects.map((x) => x.label)).toEqual(['Laptop', 'Mug']); expect(o.text).toEqual(['HELLO']); expect(o.people).toBe(2);
    expect(Object.keys(o)).not.toContain('name');
    expect(coerceObservation({ objects: [] })).toBeNull(); expect(coerceObservation('text')).toBeNull();
    const a = coerceObservation({ description: 'x', objects: [{ label: 'Laptop' }, { label: 'mug' }] })!, b = coerceObservation({ description: 'y', objects: [{ label: 'laptops' }, { label: 'Phone' }] })!;
    expect(labelDiff(a, b)).toEqual({ added: ['Phone'], gone: ['mug'] });
  });
});

class FakeTrack { stopped = false; private l: (() => void)[] = []; stop() { this.stopped = true; } addEventListener(_e: string, f: () => void) { this.l.push(f); } removeEventListener() { this.l = []; } end() { this.l.forEach((f) => f()); } }
const fakeStream = () => { const t = new FakeTrack(); return { track: t, stream: { getTracks: () => [t], getVideoTracks: () => [t] } as unknown as MediaStream }; };
function rig(o: { deny?: string; busy?: () => boolean; available?: boolean | null; analyze?: (b: { image: string; previous: string }, s: AbortSignal) => Promise<unknown> } = {}) {
  let now = 1_000_000; let sigN = 0; const sent: { image: string; previous: string; signal: AbortSignal }[] = [];
  const doc = { hidden: false, l: [] as (() => void)[], addEventListener(_: string, f: () => void) { this.l.push(f); }, removeEventListener(_: string, f: () => void) { this.l = this.l.filter((x) => x !== f); } };
  const s = fakeStream();
  const analyze = o.analyze ?? (async (b: { image: string; previous: string }, signal: AbortSignal) => { sent.push({ ...b, signal }); return { observation: { description: `view ${sent.length}`, objects: [{ label: 'Laptop', description: '', position: '' }], text: [], changes: [], uncertainties: [], people: 0 }, model: 'm' }; });
  const v = new LiveVision({
    analyze: (b, sig) => analyze(b, sig), busy: o.busy ?? (() => false), available: () => o.available ?? true, now: () => now, doc: doc as unknown as Document,
    getUserMedia: async () => { if (o.deny) throw Object.assign(new Error('x'), { name: o.deny }); return s.stream; },
    grab: () => ({ url: JPEG, sig: new Uint8Array(192).fill(sigN) }),
  });
  return { v, sent, doc, track: s.track, tick: (ms: number) => { now += ms; }, changeView: () => { sigN += 50; } };
}

describe('[A149] Live Vision controller', () => {
  it('[A149] nothing happens until start(); denied permission is explained and the camera stays off', async () => {
    const r = rig({ deny: 'NotAllowedError' });
    expect(r.v.getSnapshot().status).toBe('off'); expect(await r.v.tick()).toBe('idle'); expect(r.sent).toHaveLength(0);
    expect(await r.v.start()).toBe(false);
    expect(r.v.getSnapshot()).toMatchObject({ status: 'error' }); expect(r.v.getSnapshot().error).toMatch(/permission was denied/);
    const n = rig({ deny: 'NotFoundError' }); await n.v.start(); expect(n.v.getSnapshot().error).toMatch(/No camera/);
  });
  it('[A149] one frame per tick, never two at once (no queue), and the observation context is kept', async () => {
    let release!: () => void; const gate = new Promise<void>((res) => { release = res; }); let calls = 0;
    const r = rig({ analyze: async () => { calls++; await gate; return { observation: { description: 'a desk', objects: [], text: [], changes: [], uncertainties: [], people: 0 }, model: 'm' }; } });
    await r.v.start(); expect(r.v.getSnapshot().status).toBe('live');
    const first = r.v.tick(); expect(r.v.inFlight).toBe(1);
    expect(await r.v.tick()).toBe('skipped'); expect(await r.v.tick()).toBe('skipped'); expect(calls).toBe(1);
    release(); await first; expect(r.v.inFlight).toBe(0);
    expect(r.v.getSnapshot().latest?.description).toBe('a desk'); expect(r.v.obs.notes(Date.now())).toContain('a desk');
    r.v.stop();
  });
  it('[A149] the same view while the observation is fresh sends nothing; a changed view does, with the previous observation for comparison', async () => {
    const r = rig(); await r.v.start();
    await r.v.tick(); expect(r.sent).toHaveLength(1); expect(r.sent[0].previous).toBe('');
    r.tick(3000); expect(await r.v.tick()).toBe('skipped'); expect(r.sent).toHaveLength(1);
    r.changeView(); r.tick(3000); await r.v.tick(); expect(r.sent).toHaveLength(2); expect(r.sent[1].previous).toContain('view 1');
    expect(similar(new Uint8Array(192).fill(10), new Uint8Array(192).fill(12))).toBe(true);
    r.v.stop();
  });
  it('[A149] waits while NEXUS answers, pauses while the tab is hidden, and a question takes a fresh frame and cancels background work', async () => {
    let busy = false; const r = rig({ busy: () => busy }); await r.v.start();
    busy = true; expect(await r.v.tick()).toBe('skipped'); busy = false;
    r.doc.hidden = true; r.doc.l.forEach((f) => f()); expect(r.v.getSnapshot().status).toBe('paused'); expect(await r.v.tick()).toBe('idle'); expect(r.sent).toHaveLength(0);
    r.doc.hidden = false; r.doc.l.forEach((f) => f()); expect(r.v.getSnapshot().status).toBe('live');
    const p = r.v.tick(); const q = r.v.forQuestion()!;
    expect(r.sent[0].signal.aborted).toBe(true); await p;
    expect(q.frame).toBe(JPEG); expect(q.ageS).toBe(0);
    r.v.stop();
  });
  it('[A149] STOP: every track stopped, the request in flight aborted, observations forgotten, nothing sent afterwards', async () => {
    const r = rig(); await r.v.start(); await r.v.tick(); expect(r.v.getSnapshot().latest).not.toBeNull();
    r.changeView(); const p = r.v.tick(); const sig = r.sent.at(-1)!.signal;
    r.v.stop(); await p;
    expect(r.track.stopped).toBe(true); expect(sig.aborted).toBe(true);
    expect(r.v.getSnapshot()).toMatchObject({ status: 'off', latest: null, previous: null, analysing: false }); expect(r.v.forQuestion()).toBeNull();
    const n = r.sent.length; r.changeView(); expect(await r.v.tick()).toBe('idle'); expect(r.sent).toHaveLength(n);
    expect(r.doc.l).toHaveLength(0);                                  // the visibility listener is gone too
    expect(await r.v.start()).toBe(true); expect(r.v.getSnapshot().status).toBe('live'); r.v.stop();   // restart works
  });
  it('[A149] a disconnected camera stops Live Vision with an explanation', async () => {
    const r = rig(); await r.v.start(); r.track.end();
    expect(r.v.getSnapshot().status).toBe('error'); expect(r.v.getSnapshot().error).toMatch(/disconnected/);
  });
  it('[A149] failures are honest: an unavailable model pauses observation with its reason; a network error backs off; nothing is invented', async () => {
    let mode = 'unconfigured';
    const r = rig({ analyze: async () => { throw Object.assign(new Error(mode === 'unconfigured' ? 'Live Vision needs an AI model' : 'Could not reach the server'), { code: mode, retryable: mode !== 'unconfigured' }); } });
    await r.v.start(); await r.v.tick();
    expect(r.v.getSnapshot().notice).toMatch(/needs an AI model/); expect(r.v.getSnapshot().latest).toBeNull();
    expect(await r.v.tick()).toBe('idle');                             // paused until Retry
    mode = 'network'; r.v.retry(); await r.v.tick();
    expect(r.v.getSnapshot().notice).toMatch(/could not be analysed.*Trying again in 4 s/); expect(r.v.getSnapshot().intervalMs).toBe(4000);
    r.v.stop();
  });
  it('[A149] the controller never starts the camera by itself', async () => {
    const gum = vi.fn(); const v = new LiveVision({ analyze: vi.fn(), busy: () => false, available: () => true, getUserMedia: gum, doc: null });
    await v.tick(); v.forQuestion(); v.retry(); v.attachVideo(null); expect(gum).not.toHaveBeenCalled();
  });
});

describe('[A150] visual context across the conversation', () => {
  const ob = (description: string, labels: string[]) => coerceObservation({ description, objects: labels.map((label) => ({ label })) })!;
  it('[A150] earlier, clearly different views are kept (text only, a few) and labelled as possibly out of view; stop forgets them', () => {
    const m = new ObservationManager(); let t = 0;
    m.push(ob('A desk with a laptop and a mug.', ['laptop', 'mug']), t += 1000, 'm');
    m.push(ob('The same desk.', ['laptop', 'mug']), t += 1000, 'm');
    m.push(ob('A bookshelf.', ['books', 'plant']), t += 1000, 'm');
    m.push(ob('A window with a fan.', ['window', 'fan']), t += 1000, 'm');
    expect(m.latest!.description).toMatch(/window/); expect(m.previous!.description).toMatch(/bookshelf/);
    expect(m.earlier.map((o) => o.description)).toEqual(['The same desk.']);   // the desk view moved out once the scene changed
    const notes = m.notes(t + 2000);
    expect(notes).toMatch(/^Newest observation \(2 s ago\): A window/);
    expect(notes).toMatch(/Earlier view \(4 s ago, may no longer be in view\): The same desk\. Objects: laptop, mug\./);
    for (let i = 0; i < 10; i++) m.push(ob(`scene ${i}`, [`thing${i}`]), t += 1000, 'm');
    expect(m.earlier.length).toBe(EARLIER_SCENES); expect(m.notes(t).length).toBeLessThanOrEqual(2900);
    m.clear(); expect(m.earlier).toEqual([]); expect(m.notes(t)).toBe('');
  });
  it('[A150] a scene counts as different only when the object lists barely overlap', () => {
    expect(differentScene(ob('a', ['laptop', 'mug', 'pen']), ob('b', ['laptops', 'mug', 'phone']))).toBe(false);
    expect(differentScene(ob('a', ['laptop', 'mug']), ob('b', ['dog']))).toBe(true);
    expect(differentScene(ob('a', []), ob('b', ['dog']))).toBe(false);
  });
  it('[A150] camera turns are marked in the history sent to the model, and the flag (never the frame) is saved with the chat', () => {
    const msgs: UIMessage[] = [
      { id: '1', role: 'user', text: 'what is this?', at: 1, status: 'complete', vision: true },
      { id: '2', role: 'assistant', text: 'Looks like a desk fan.', at: 2, status: 'complete', replyTo: '1' },
      { id: '3', role: 'user', text: 'why is it not spinning?', at: 3, status: 'complete' },
    ];
    expect(buildContext(msgs, 10).map((m) => m.content)).toEqual(['[camera on] what is this?', 'Looks like a desk fan.', 'why is it not spinning?']);
    expect(toStored(msgs)[0].vision).toBe(true); expect('vision' in toStored(msgs)[1]).toBe(false);
  });
  const req = (messages: { role: 'user' | 'assistant'; content: string }[], vision = false) => ({
    messages, skills: [], expressions: [], memory: [], preferences: [], profile: { responseStyle: 'balanced', language: 'English', robotName: 'NEXUS', personality: {}, visuals: 'auto' }, lastSkillId: null,
    ...(vision ? { context: { workspace: '', knowledge: [], vision: { notes: 'Newest observation (0 s ago): a fan.', ageS: 0 } } } : {}),
  }) as unknown as ChatRequest;
  it('[A150] once Live Vision is off, the prompt forbids claiming to still see earlier camera views', () => {
    const hist = [{ role: 'user' as const, content: '[camera on] what is this?' }, { role: 'assistant' as const, content: 'A desk fan.' }, { role: 'user' as const, content: 'is it still there?' }];
    const off = conversationBlock(req(hist));
    expect(off).toMatch(/LIVE VISION IS OFF NOW/); expect(off).toMatch(/never say or imply you can see them now/);
    expect(conversationBlock(req(hist, true))).toMatch(/may have changed — trust the attached frame/);
    const plain = conversationBlock(req([{ role: 'user', content: 'hi' }]));
    expect(plain).toMatch(/resolve "it", "that"/); expect(plain).not.toMatch(/LIVE VISION/);
    // the new turn's own text never triggers the off-state (only earlier turns count)
    expect(conversationBlock(req([{ role: 'user', content: '[camera on] hi' }]))).not.toMatch(/LIVE VISION IS OFF/);
  });
  it('[A150] the live prompt asks for natural phrasing, frame positions for "left/right", and a question when a reference is ambiguous', () => {
    const p = buildSystemPrompt(req([{ role: 'user', content: 'what about the other one?' }], true), { streaming: true, sources: [], compact: false, fresh: false });
    expect(p).toMatch(/Looks like you've got a laptop there/); expect(p).toMatch(/never a report/);
    expect(p).toMatch(/"the one on the left\/right" uses positions in the frame/); expect(p).toMatch(/If two or more things fit, ask which one/);
    expect(p).toMatch(/say it is out of view now/); expect(p).toMatch(/CONVERSATION — this is one continuous conversation/);
    const compact = buildSystemPrompt(req([{ role: 'user', content: 'hi' }]), { streaming: true, sources: [], compact: true, fresh: false });
    expect(compact).toMatch(/CONVERSATION —/);
  });
});
