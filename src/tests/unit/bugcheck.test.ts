/** Regression tests for the full bug check (round 3). */
import { describe, expect, it } from 'vitest';
import { StreamParser } from '../../../shared/streamParser';

const run = (chunks: string[]) => { const p = new StreamParser(); let vis = ''; for (const c of chunks) vis += p.feed(c).delta; return { vis, ...p.end() }; };

describe('[BC3] streamed reply parsing', () => {
  it('[BC3] a reply that continues on the HEAD line keeps both the head and the text', () => {
    const r = run(['HEAD {"expression":"happy"} Hello on the same line', ' and more']);
    expect(r.head).toEqual({ expression: 'happy' }); expect(r.vis).toBe('Hello on the same line and more');
  });
  it('[BC3] braces inside head strings and split chunks are handled; the meta marker never leaks', () => {
    const r = run(['HEAD {"expression":"hap', 'py","note":"}{"}', '\n', 'Text<<<ME', 'TA>>>{"a":1}']);
    expect(r.head).toEqual({ expression: 'happy', note: '}{' }); expect(r.vis).toBe('Text'); expect(r.metaRaw).toBe('{"a":1}');
  });
  it('[BC3] a stream that ends inside the HEAD line never shows raw JSON as the reply', () => {
    const r = run(['HEAD {"expression":"happy"']); expect(r.text).toBe(''); expect(r.headError).toMatch(/HEAD/);
  });
  it('[BC3] ordinary text starting with "HEAD…" stays text', () => { expect(run(['HEADS UP: careful']).vis).toBe('HEADS UP: careful'); });
});

describe('[BC3] JSON replies', () => {
  it('[BC3] a JSON reply whose text contains a ``` code block is read whole; fenced and chatty outputs still work', async () => {
    const { extractJSON } = await import('../../../server/prompts/system');
    expect(extractJSON('{"reply":"Here is code:\\n```js\\nconst a = {b: 1};\\n```\\nDone."}')).toEqual({ reply: 'Here is code:\n```js\nconst a = {b: 1};\n```\nDone.' });
    expect(extractJSON('Sure!\n```json\n{"reply":"hi"}\n```')).toEqual({ reply: 'hi' });
    expect(extractJSON('```python\nprint(1)\n```\n{"reply":"after"}')).toEqual({ reply: 'after' });
    expect(() => extractJSON('no json here')).toThrow(/no JSON/);
    expect(() => extractJSON('{"reply": "cut')).toThrow(/unterminated/);
  });
});

describe('[BC3] HOLOBUILD requests that are overtaken', () => {
  const setup = async () => {
    const { MemoryKV } = await import('../../storage/db'); const { HoloStore } = await import('../../holobuild/store'); const { HoloController } = await import('../../holobuild/controller');
    const gates: { path: string; res: (v: unknown) => void; rej: (e: unknown) => void; signal?: AbortSignal }[] = [];
    const task = (path: string, _b: unknown, signal?: AbortSignal) => new Promise((res, rej) => { gates.push({ path, res, rej, signal }); signal?.addEventListener('abort', () => rej(Object.assign(new Error('Cancelled'), { name: 'AbortError' }))); });
    const c = new HoloController({ store: new HoloStore(new MemoryKV()), task, aiAvailable: () => true });
    return { c, gates };
  };
  const design = (name: string) => ({ model: { name, category: 'x', description: 'd', parts: [{ id: 'body', name: 'Body', shape: 'box', size: [1, 1, 1], position: [0, 0.5, 0] }], steps: [], facts: [] } });
  it('[BC3] a build replaced by a newer one neither reports an error nor clears "busy" for the newer one', async () => {
    const { c, gates } = await setup();
    const first = c.build('a flux capacitor'); const second = c.build('a warp core');
    expect(await first).toMatchObject({ kind: 'none' });
    expect(c.getSnapshot().busy).toBe(true); expect(c.getSnapshot().status.kind).toBe('working');
    gates[1].res(design('Warp core')); await second;
    expect(c.getSnapshot().model?.name).toBe('Warp core'); expect(c.getSnapshot().busy).toBe(false);
  });
  it('[BC3] an AI edit answer is never applied to a different model opened meanwhile', async () => {
    const { c, gates } = await setup();
    const b = c.build('a flux capacitor'); gates[0].res(design('Flux capacitor')); await b;
    const first = c.getSnapshot().model!;
    const edit = c.command('make it sparkle like a disco');
    c.open({ ...first, id: 'other', name: 'Another model' });
    gates[1].res({ ops: [{ op: 'remove', target: 'body' }] });
    expect(await edit).toMatchObject({ kind: 'none' });
    expect(c.getSnapshot().model?.name).toBe('Another model'); expect(c.getSnapshot().model?.parts).toHaveLength(1);
  });
});

describe('[BC3] learning', () => {
  it('[BC3] trimming old workflow-skill versions never drops the active one', async () => {
    const { keepVersions } = await import('../../learning/engine'); const { LEARN_LIMITS } = await import('../../../shared/learning');
    const vs = Array.from({ length: LEARN_LIMITS.versions + 1 }, (_, i) => ({ version: i + 1 }));
    const kept = keepVersions(vs, 1); expect(kept).toHaveLength(LEARN_LIMITS.versions); expect(kept.some((v) => v.version === 1)).toBe(true); expect(kept.some((v) => v.version === 2)).toBe(false);
  });
  it('[BC3] the browser counts independent sources like the server (bbc.co.uk ≠ independent.co.uk)', async () => {
    const { orgOf } = await import('../../../shared/learning');
    expect(orgOf('bbc.co.uk')).not.toBe(orgOf('independent.co.uk')); expect(orgOf('en.wikipedia.org')).toBe(orgOf('de.wikipedia.org'));
  });
});

describe('[BC3] conversation context', () => {
  it('[BC3] a question whose reply failed is not glued onto the next one; an interrupted one stays', async () => {
    const { buildContext } = await import('../../ai/context');
    const M = (id: string, role: 'user' | 'assistant', text: string, status: 'complete' | 'failed' | 'cancelled', replyTo?: string) => ({ id, role, text, status, at: 0, replyTo });
    const ctx = buildContext([M('u1', 'user', 'what is X?', 'complete'), M('a1', 'assistant', '', 'failed', 'u1'), M('u2', 'user', 'tell me a story', 'complete'), M('a2', 'assistant', 'Once', 'cancelled', 'u2'), M('u3', 'user', 'a short one', 'complete')], 16);
    expect(ctx).toEqual([{ role: 'user', content: 'tell me a story\na short one' }]);
  });
});

describe('[BC3] voice settings', () => {
  it('[BC3] switching the voice from ElevenLabs to an OpenAI-compatible service does not keep the ElevenLabs URL, key and model', async () => {
    const { readSpeechConfig, applySpeechRuntime } = await import('../../../server/speech');
    const base = readSpeechConfig({ ELEVENLABS_API_KEY: 'el-key', ELEVENLABS_VOICE_ID: 'v1', OPENAI_API_KEY: 'sk-x', TTS_MODEL: 'tts-1', TTS_VOICE: 'alloy' } as NodeJS.ProcessEnv);
    expect(base.tts.provider).toBe('elevenlabs');
    const c = applySpeechRuntime(base, { ttsProvider: 'openai' });
    expect(c.tts).toMatchObject({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-x', model: 'tts-1', voice: 'alloy' });
    expect(applySpeechRuntime(base, { ttsProvider: 'openai', ttsModel: 'gpt-tts' }).tts.model).toBe('gpt-tts');   // explicit values still win
  });
});

describe('[BC3] browser speech recognition', () => {
  it('[BC3] a recogniser replaced by a new listening session cannot deliver its late transcript or end the new session', async () => {
    const { vi } = await import('vitest');
    class FakeRec { static all: FakeRec[] = []; lang = ''; interimResults = false; continuous = false; maxAlternatives = 1; onresult: ((e: unknown) => void) | null = null; onerror: ((e: { error: string }) => void) | null = null; onend: (() => void) | null = null; onstart: (() => void) | null = null; constructor() { FakeRec.all.push(this); } start() { this.onstart?.(); } stop() { this.onend?.(); } abort() { /* the real one ends asynchronously */ } }
    vi.stubGlobal('window', { webkitSpeechRecognition: FakeRec });
    const { SpeechInput } = await import('../../voice/recognition');
    const si = new SpeechInput(); const a: string[] = [], b: string[] = [];
    si.start({ onInterim() {}, onFinal: (t) => a.push(t), onError() {}, onState: (s) => a.push(`s:${s}`) });
    const old = FakeRec.all[0]; old.onresult!({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'old words' } }] });
    si.start({ onInterim() {}, onFinal: (t) => b.push(t), onError() {}, onState: (s) => b.push(`s:${s}`) });
    old.onend!();                                                     // the aborted recogniser's late end event
    expect(a).not.toContain('old words'); expect(si.listening).toBe(true); expect(b).toEqual(['s:true']);
    FakeRec.all[1].onresult!({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'new words' } }] }); si.stop();
    expect(b).toContain('new words');
    vi.unstubAllGlobals();
  });
});
