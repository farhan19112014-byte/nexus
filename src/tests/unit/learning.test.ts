import { describe, expect, it } from 'vitest';
import { LearningEngine } from '../../learning/engine';
import { MemoryKV } from '../../storage/db';
import { evaluateTest, retrieve, KnowledgeSchema, type Knowledge } from '../../../shared/learning';

const report = (over: Record<string, unknown> = {}) => ({
  queries: ['mars moons'], provider: 'searxng', model: 'mock', summary: 'Mars has two moons [1][2].', contradictions: [], dropped: 1, searchErrors: [],   // exactly what the server sends
  sources: [{ id: 1, title: 'NASA', url: 'https://science.nasa.gov/mars/', domain: 'science.nasa.gov', retrievedAt: new Date().toISOString(), credibility: 'high' }, { id: 2, title: 'Britannica', url: 'https://www.britannica.com/place/Mars-planet', domain: 'britannica.com', retrievedAt: new Date().toISOString(), credibility: 'high' }],
  claims: [{ claim: 'Mars has two moons, Phobos and Deimos.', topic: 'mars moons', category: 'science', sources: [1, 2], contradictedBy: [], status: 'verified', basis: 'Stated by 2 independent sources.' }, { claim: 'A day on Mars lasts about 24.6 hours.', topic: 'mars day', category: 'science', sources: [1], contradictedBy: [], status: 'pending', basis: 'Only one independent source.' }],
  ...over,
});
function setup(o: { ai?: boolean | null; reply?: (path: string, body: unknown) => unknown; now?: () => number } = {}) {
  const kv = new MemoryKV(); const calls: { path: string; body: unknown }[] = []; const acts: string[] = [];
  const eng = new LearningEngine({
    kv, aiAvailable: () => o.ai ?? true, now: o.now,
    task: async (path, body) => { calls.push({ path, body }); if (!o.reply) throw new Error('offline'); return o.reply(path, body); },
    activity: (k, l) => { acts.push(`${k}:${l}`); return (r) => acts.push(`end:${r}`); }, idle: () => true,
  });
  return { eng, kv, calls, acts };
}

describe('Learning engine', () => {
  it('[A133] records only real, defined events — short and redacted; sensitive text is skipped; repeats, corrections, gaps and failures are detected by rules', async () => {
    const { eng } = setup(); await eng.ready;
    await eng.observeExchange({ msgId: 'm1', user: 'How many moons does Mars have?', reply: "I'm not sure, I can't verify that.", uncertainty: 'high' });
    await eng.observeExchange({ msgId: 'm2', user: 'how many moons does mars have', reply: 'Two.', uncertainty: 'low' });
    await eng.observeExchange({ msgId: 'm3', user: 'No, that is wrong — it has two.', reply: 'You are right.', previousReply: 'It has three.' });
    await eng.observeExchange({ msgId: 'm4', user: 'my password is hunter2, what is a moon?', reply: 'I do not know' });
    await eng.observeExchange({ msgId: 'm5', user: 'Tell me a story', reply: '', failed: 'timeout: no answer' });
    await eng.feedback('m2', true, 'how many moons does mars have');
    const types = eng.experiences.map((e) => e.type).sort();
    expect(types).toEqual(['correction', 'failure', 'feedback-positive', 'knowledge-gap', 'repeated-question'].sort());
    expect(eng.experiences.every((e) => e.summary.length <= 300)).toBe(true);
    expect(JSON.stringify(eng.experiences)).not.toMatch(/hunter2/);
    expect(eng.queue).toHaveLength(1); expect(eng.queue[0]).toMatchObject({ trigger: 'gap', approved: false });   // default: ask first
    await eng.updateSettings({ collect: false }); await eng.observeExchange({ msgId: 'm6', user: 'What is a quasar?', reply: 'not sure', uncertainty: 'high' });
    expect(eng.experiences).toHaveLength(5);   // collecting is off → nothing new
    await eng.deleteExperience(eng.experiences[0].id); expect(eng.experiences).toHaveLength(4);
    expect(eng.audit.some((a) => a.action === 'settings' && /collect = false/.test(a.detail))).toBe(true);
  });

  it('[A134] research results become knowledge with status and sources; duplicates merge; retrieval feeds chats; corrections and rejections are honoured', async () => {
    const { eng, acts } = setup({ reply: () => report() }); await eng.ready;
    const r = await eng.research('How many moons does Mars have?'); expect(r).not.toBeNull();
    expect(acts).toEqual(['researching:How many moons does Mars have?', 'end:done']);
    expect(eng.knowledge.map((k) => k.status).sort()).toEqual(['pending', 'verified']);
    await eng.research('Mars moons'); expect(eng.knowledge).toHaveLength(2);                 // same claims: merged, not duplicated
    expect(eng.contextFor('Explain the moons of Mars to me').length).toBeGreaterThan(0);   // filler verbs do not block retrieval
    const ctx = eng.contextFor('how many moons orbit mars?'); expect(ctx[0]).toMatchObject({ claim: 'Mars has two moons, Phobos and Deimos.', status: 'verified' });
    expect(ctx[0].sources[0]).toMatch(/nasa/);
    const day = eng.knowledge.find((k) => /24\.6/.test(k.claim))!;
    await eng.setStatus(day.id, 'rejected'); expect(eng.contextFor('how long is a day on mars').some((k) => /24\.6/.test(k.claim))).toBe(false);
    const moons = eng.knowledge.find((k) => /two moons/.test(k.claim))!;
    await eng.editClaim(moons.id, 'Mars has two small moons: Phobos and Deimos.');
    expect(eng.knowledge.find((k) => k.id === moons.id)).toMatchObject({ status: 'pending', userEdited: true });   // edited text is no longer what the sources said
    await eng.updateSettings({ useKnowledge: false }); expect(eng.contextFor('mars moons')).toEqual([]);
    expect(eng.metrics().research).toMatchObject({ reports: 2, today: 2 });
  });

  it('[A134] research is refused honestly without AI or over the daily limit, and a failure is recorded (never a fake success)', async () => {
    const off = setup({ ai: false }); await off.eng.ready;
    expect(await off.eng.research('What is a quasar?')).toBeNull(); expect(off.eng.lastError).toMatch(/No AI model/); expect(off.calls).toHaveLength(0);
    const lim = setup({ reply: () => report() }); await lim.eng.ready; await lim.eng.updateSettings({ dailyResearch: 1 });
    await lim.eng.research('Mars moons'); expect(await lim.eng.research('Venus moons')).toBeNull(); expect(lim.eng.lastError).toMatch(/limit/);
    const bad = setup(); await bad.eng.ready;
    expect(await bad.eng.research('Saturn rings')).toBeNull(); expect(bad.eng.experiences[0].type).toBe('failure'); expect(bad.eng.knowledge).toHaveLength(0);
    expect(bad.acts.at(-1)).toBe('end:failed');
  });

  it('[A135] workflow skills: draft → isolated tests → approval only when all pass → run counts → improved version → rollback; all audited', async () => {
    let quality = 'good';
    const body = { description: 'Explain a part simply.', inputs: [{ name: 'part', description: '' }], procedure: ['Name it.', 'Say what it does.'], tools: ['conversation'], output: 'Two sentences.', limitations: '', tests: [{ input: 'piston', mustInclude: ['piston'], mustNotInclude: [], maxChars: 200 }] };
    const { eng } = setup({ reply: (path, b) => {
      if (path === '/api/learn/skill/draft') return { name: 'Part explainer', body: { ...body, tests: (b as { problems?: string[] }).problems?.length ? [{ input: 'gear', mustInclude: ['gear'], mustNotInclude: [], maxChars: 200 }] : body.tests } };
      return { output: quality === 'good' ? `A ${(b as { input: string }).input} is a part that moves.` : 'Something long and unrelated '.repeat(20) };
    } });
    await eng.ready;
    const s = (await eng.draftSkill('explain parts to kids'))!; expect(s.active).toBeNull(); expect(s.versions[0].status).toBe('draft');
    expect(await eng.approve(s.id, 1)).toEqual({ ok: false, why: expect.stringMatching(/Run the tests first/) });
    quality = 'bad'; let t = await eng.testVersion(s.id, 1); expect(t).toMatchObject({ passed: 0, total: 1 }); expect((await eng.approve(s.id, 1)).ok).toBe(false);
    quality = 'good'; t = await eng.testVersion(s.id, 1); expect(t).toMatchObject({ passed: 1, total: 1 }); expect((await eng.approve(s.id, 1)).ok).toBe(true);
    expect(await eng.runSkill(s.id, 'camshaft')).toBe('A camshaft is a part that moves.'); expect(eng.skills[0].metrics).toMatchObject({ runs: 1, ok: 1 });
    const v2 = (await eng.improve(s.id, ['also handle gears']))!; expect(v2.version).toBe(2); expect(v2.status).toBe('draft');
    expect(v2.body.tests.map((x) => x.input)).toEqual(['piston', 'gear']);                       // old tests are kept
    expect(eng.skills[0].active).toBe(1);                                                         // the draft does not replace the active version
    await eng.testVersion(s.id, 2); expect((await eng.approve(s.id, 2)).ok).toBe(true); expect(eng.skills[0].active).toBe(2);
    expect(await eng.rollback(s.id)).toBe(true); expect(eng.skills[0].active).toBe(1); expect(eng.skills[0].versions.find((v) => v.version === 2)!.status).toBe('rejected');
    const actions = eng.audit.map((a) => a.action); for (const a of ['draft skill', 'test skill', 'approve skill', 'propose skill version', 'rollback skill']) expect(actions).toContain(a);
    expect(evaluateTest({ input: 'x', mustInclude: ['a'], mustNotInclude: ['b'], maxChars: 5 }, 'a b')).toEqual({ ok: false, why: 'contains “b”' });
  });

  it('[A136] background learning: off by default; when on it runs only approved questions or due re-checks, within limits, and logs what it really did', async () => {
    let t = 1_000_000_000_000; const now = () => t;
    const { eng, calls } = setup({ reply: () => report(), now }); await eng.ready;
    expect(eng.settings.background).toBe(false); expect(await eng.tick()).toBe('');
    await eng.updateSettings({ background: true, gapResearch: 'ask' });
    await eng.noteGap('How many moons does Mars have?', 'gap');
    expect(await eng.tick()).toBe(''); expect(calls).toHaveLength(0);                            // not approved yet → nothing runs
    await eng.approveGap(0); const did = await eng.tick();
    expect(did).toMatch(/Researched “How many moons does Mars have\?”: 2 claim\(s\) from 2 source\(s\)/); expect(calls).toHaveLength(1);
    expect(await eng.tick()).toBe('');                                                             // interval not elapsed
    // a verified note past its review date is re-checked; not confirmed → marked outdated
    t += 400 * 86400000;
    const ret = setup({ reply: () => report({ claims: [] }), now }); await ret.eng.ready; await ret.eng.updateSettings({ background: true });
    const k: Knowledge = KnowledgeSchema.parse({ id: 'k1', claim: 'Mars has two moons, Phobos and Deimos.', status: 'verified', origin: 'research', createdAt: 0, updatedAt: 0, reviewAfter: t - 1 });
    ret.eng.knowledge = [k];
    expect(await ret.eng.tick()).toMatch(/not confirmed — marked outdated/); expect(ret.eng.knowledge[0].status).toBe('outdated');
    await ret.eng.updateSettings({ paused: true }); expect(await ret.eng.tick()).toBe('');
    expect(ret.eng.audit.some((a) => a.action === 'background step')).toBe(true);
    // retrieval: outdated verified notes are labelled outdated when used
    expect(retrieve([{ ...k, status: 'verified' }], 'mars moons', 4, t)[0].status).toBe('outdated');
  });
});
