import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { openStore, MemoryKV } from '../../storage/db';
import { MemoryStore } from '../../memory/store';
import { rankMemories } from '../../memory/retrieval';
import { buildContext, type UIMessage } from '../../ai/context';

let n = 0; const db = () => openStore(`mem-${Date.now()}-${n++}`);
const mk = async (kv = db()) => { const m = new MemoryStore(kv); await m.ready; return m; };
const C = (text: string, o: object = {}) => ({ text, category: 'fact' as const, reason: '', explicit: true, ...o });

describe('Category F — memory & personalization', () => {
  it('[A51] session memory: bounded context, failed/cancelled turns excluded, ordering kept', () => {
    const msgs: UIMessage[] = [
      { id: '1', role: 'user', text: 'hi', at: 1, status: 'complete' }, { id: '2', role: 'assistant', text: 'hello', at: 2, status: 'complete' },
      { id: '3', role: 'user', text: 'q2', at: 3, status: 'complete' }, { id: '4', role: 'assistant', text: 'partial', at: 4, status: 'cancelled' },
      { id: '5', role: 'system', text: 'notice', at: 5, status: 'complete' }, { id: '6', role: 'user', text: 'q3', at: 6, status: 'complete' },
    ];
    const c = buildContext(msgs, 10);
    expect(c.map((m) => m.content)).toEqual(['hi', 'hello', 'q2\nq3']);
    expect(buildContext(msgs, 1)).toEqual([{ role: 'user', content: 'q3' }]);
  });
  it('[A52] persistent store: documented schema, survives reload, corrupted rows skipped', async () => {
    const kv = db(); const m = await mk(kv);
    expect((await m.remember(C('I like green tea'), 'explicit_request')).status).toBe('saved');
    await kv.put('memory', { id: 'bad', text: 42 });
    const m2 = await mk(kv);
    expect(m2.active().map((x) => x.text)).toEqual(['I like green tea']); expect(m2.loadErrors.length).toBe(1);
  });
  it('[A53] extraction needs consent: suggestions are not saved until accepted; sensitive refused', async () => {
    const m = await mk();
    const s = m.suggest(C('User is learning Rust', { explicit: false }))!;
    expect(m.active()).toHaveLength(0);
    expect((await m.acceptSuggestion(s.id))!.status).toBe('saved'); expect(m.active()).toHaveLength(1);
    expect(m.suggest(C('my password is hunter2', { explicit: false }))).toBeNull();
    expect((await m.remember(C('card 4111 1111 1111 1111'), 'explicit_request')).status).toBe('sensitive');
    await m.updateSettings({ memoryEnabled: false });
    expect((await m.remember(C('I live on Mars'), 'explicit_request')).status).toBe('disabled'); expect(m.contextLines('mars')).toEqual([]);
  });
  it('[A54] retrieval: only relevant memories are loaded; rules always apply', async () => {
    const m = await mk();
    await m.remember(C('My favourite colour is teal', { category: 'preference', key: 'favourite_colour' }), 'explicit_request');
    await m.remember(C('I have a dog named Bruno'), 'explicit_request');
    await m.remember(C('Always answer briefly', { category: 'rule' }), 'manual');
    const got = m.retrieve('what colour should I paint my room?').map((x) => x.text);
    expect(got).toContain('My favourite colour is teal'); expect(got).toContain('Always answer briefly'); expect(got).not.toContain('I have a dog named Bruno');
    expect(rankMemories([{ id: 'a', text: 'unrelated text', category: 'fact', updatedAt: 1 }], 'quantum physics')).toEqual([]);
  });
  it('[A55] inspection data: why, when, source and last-used are recorded', async () => {
    const m = await mk(); await m.remember(C('I prefer metric units', { reason: 'you asked me to remember this' }), 'explicit_request');
    m.retrieve('units'); const it = m.active()[0];
    expect(it).toMatchObject({ reason: 'you asked me to remember this', source: 'explicit_request' });
    expect(it.createdAt).toBeGreaterThan(0); expect(it.lastUsedAt).toBeGreaterThan(0);
  });
  it('[A56] edit and delete change the stored records', async () => {
    const kv = db(); const m = await mk(kv);
    const r = await m.remember(C('I work at Qlass'), 'explicit_request');
    expect(await m.edit(r.item!.id, 'I work at Qlass on EduBot')).toBe(true);
    expect((await kv.get<{ text: string }>('memory', r.item!.id))!.text).toBe('I work at Qlass on EduBot');
    await m.forget(r.item!.id); expect(await kv.get('memory', r.item!.id)).toBeUndefined();
    const failing = new MemoryKV(); const mf = await mk(failing as never); const r2 = await mf.remember(C('x y z'), 'manual'); failing.failWrites = true;
    await expect(mf.forget(r2.item!.id)).rejects.toThrow(/Delete failed/); expect(mf.active()).toHaveLength(1);
  });
  it('[A57] preference profile is validated and persisted', async () => {
    const kv = db(); const m = await mk(kv);
    await m.updateSettings({ responseStyle: 'concise', language: 'Hindi', animationIntensity: 0.5, reducedMotion: true, quietMode: true });
    const m2 = await mk(kv); expect(m2.settings).toMatchObject({ responseStyle: 'concise', language: 'Hindi', animationIntensity: 0.5, reducedMotion: true, quietMode: true });
    await expect(m.updateSettings({ animationIntensity: 9 } as never)).rejects.toThrow();
  });
  it('[A58] boundaries documented: session, persistent, provider-side, retrieval, skills', () => {
    const doc = readFileSync('docs/PRIVACY.md', 'utf8');
    for (const h of ['Session context', 'Persistent memory', 'Provider-side', 'Retrieved information', 'Skill registry', 'Not stored']) expect(doc).toContain(h);
  });
  it('[A59] conflicts: same key → newer explicit wins (older kept as superseded); weaker source cannot override', async () => {
    const m = await mk();
    await m.remember(C('My favourite colour is teal', { key: 'favourite_colour', category: 'preference' }), 'explicit_request');
    const r = await m.remember(C('My favourite colour is orange', { key: 'favourite_colour', category: 'preference' }), 'explicit_request');
    expect(r.status).toBe('saved'); expect(r.superseded![0].text).toMatch(/teal/);
    expect(m.active().map((x) => x.text)).toEqual(['My favourite colour is orange']);
    expect(m.items.find((x) => x.text.includes('teal'))!.status).toBe('superseded');
    const weak = await m.remember(C('Favourite colour: purple', { key: 'favourite_colour', category: 'preference', explicit: false }), 'import');
    expect(weak.status).toBe('conflict'); expect(m.conflicts).toHaveLength(1);
    await m.resolveConflict(0, 'newer'); expect(m.active().map((x) => x.text)).toEqual(['Favourite colour: purple']);
  });
  it('[A60] export/import: validated, deduplicated, contents never executed', async () => {
    const a = await mk(); await a.remember(C('I like chess'), 'explicit_request');
    const b = await mk(); expect(await b.importJSON(a.exportJSON())).toEqual({ imported: 1, skipped: 0 });
    expect(await b.importJSON(a.exportJSON())).toEqual({ imported: 0, skipped: 1 });
    expect(await b.importJSON('{"items":[{"text":"<script>alert(1)</script>","code":"x"}]}')).toEqual({ imported: 0, skipped: 1 });
    expect(await b.importJSON('not json')).toEqual({ imported: 0, skipped: 1 });
    expect(b.active()[0].source).toBe('import');
  });
});
