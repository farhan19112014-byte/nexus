/**
 * [A106] safe Markdown · [A107] saved chats · [A109] reminders & timers · [A111] light theme · [A113] compact prompt for local models
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown, parseBlocks, safeHref } from '../../components/Markdown';
import { ChatStore, titleFor, toStored } from '../../core/chats';
import { ReminderStore, describeDue, parseDuration, parseReminder } from '../../core/reminders';
import { MemoryKV } from '../../storage/db';
import type { UIMessage } from '../../ai/context';
import { buildSystemPrompt } from '../../../server/prompts/system';
import { ChatRequestSchema } from '../../../shared/schema';
import { BUILTIN_MOTIONS } from '../../animation/builtinMotions';
import { BUILTIN_EXPRESSIONS } from '../../expressions/presets';
import { validateSkill } from '../../skills/validator';
import { readFileSync } from 'node:fs';
import { contrast } from '../../character/tokens';
import { validateRobotName } from '../../../shared/identity';

const html = (t: string) => renderToStaticMarkup(<Markdown text={t} />);

describe('[A106] safe Markdown rendering of replies', () => {
  it('[A106] formats bold, italic, code, lists, quotes, headings and code blocks', () => {
    const out = html('# Plan\n\nHere is **bold**, *italic* and `x = 1`.\n\n- one\n- two\n\n3. three\n4. four\n\n> quoted\n\n```js\nconst a = 1;\n```');
    expect(out).toContain('<h3>Plan</h3>'); expect(out).toContain('<strong>bold</strong>'); expect(out).toContain('<em>italic</em>'); expect(out).toContain('<code>x = 1</code>');
    expect(out).toMatch(/<ul><li>one<\/li><li>two<\/li><\/ul>/); expect(out).toContain('<ol start="3">'); expect(out).toContain('<blockquote>quoted</blockquote>');
    expect(out).toContain('<pre><code>const a = 1;</code></pre>'); expect(out).toContain('Copy');
  });
  it('[A106] never renders model-supplied HTML or script; only http(s) links become links', () => {
    const out = html('<img src=x onerror=alert(1)> <script>alert(1)</script> [click](javascript:alert(1)) [ok](https://example.com/a) see https://wikipedia.org/wiki/Robot.');
    expect(out).not.toMatch(/<img|<script/); expect(out).toContain('&lt;script&gt;');
    expect(out).not.toContain('href="javascript'); expect(out).toContain('href="https://example.com/a"'); expect(out).toContain('href="https://wikipedia.org/wiki/Robot"');
    expect(out).toMatch(/rel="noopener noreferrer"/);
    expect(safeHref('data:text/html,hi')).toBeNull(); expect(safeHref('mailto:a@b.c')).toBeNull();
  });
  it('[A106] snake_case and arithmetic are not mistaken for italics; an unterminated fence (streaming) is an open code block', () => {
    expect(html('use file_name_here and 2 * 3 * 4')).not.toContain('<em>');
    const b = parseBlocks('text\n```py\nprint(1)'); expect(b.at(-1)).toMatchObject({ t: 'code', open: true, text: 'print(1)' });
  });
});

const um = (role: UIMessage['role'], text: string, status: UIMessage['status'] = 'complete', at = Date.now()): UIMessage => ({ id: `${role}-${text}-${at}`, role, text, status, at });

describe('[A107] saved chats', () => {
  it('[A107] saves the current chat, survives a reload, searches, renames, opens and deletes', async () => {
    const kv = new MemoryKV(); const c = new ChatStore(kv); await c.ready;
    expect(await c.saveCurrent([um('system', 'hello')])).toBe(false); // nothing from the user yet → not saved
    await c.saveCurrent([um('user', 'Tell me about volcanoes'), um('assistant', 'Volcanoes are openings in the crust.')]);
    const first = c.currentId;
    await c.startNew();
    await c.saveCurrent([um('user', 'What is photosynthesis?'), um('assistant', 'Plants turn light into energy.'), um('assistant', 'still typing', 'streaming')]);
    const again = new ChatStore(kv); await again.ready;
    expect(again.chats).toHaveLength(2); expect(again.current?.title).toBe('What is photosynthesis?');
    expect(again.current?.messages.at(-1)?.status).toBe('cancelled'); // an in-flight reply is never saved as complete
    expect(again.search('volcano crust').map((h) => h.chat.id)).toEqual([first]);
    expect(again.search('nothing-like-this')).toHaveLength(0);
    expect(await again.rename(first, '  Volcano   facts ')).toBe(true); expect(again.chats.find((x) => x.id === first)?.title).toBe('Volcano facts');
    expect((await again.open(first))?.messages[0].text).toBe('Tell me about volcanoes');
    await again.remove(first); expect(again.chats).toHaveLength(1);
    expect(again.toMarkdown(again.chats[0], 'Nova')).toMatch(/\*\*Nova\*\*/);
  });
  it('[A107] corrupted rows are skipped; titles are short; stored messages drop unknown fields', async () => {
    const kv = new MemoryKV(); await kv.put('chats', { id: 'bad', title: 5 });
    const c = new ChatStore(kv); await c.ready; expect(c.chats).toHaveLength(0); expect(c.loadErrors[0]).toMatch(/corrupted/);
    expect(titleFor([{ role: 'user', text: 'x'.repeat(100) }]).length).toBeLessThanOrEqual(60);
    const s = toStored([{ ...um('user', 'hi'), response: { secret: 1 } as never }]); expect('response' in s[0]).toBe(false);
  });
});

describe('[A109] reminders and timers', () => {
  const now = new Date('2026-10-19T10:00:00').getTime();
  it('[A109] understands common phrasings and leaves other messages for the AI', () => {
    expect(parseReminder('remind me in 10 minutes to stretch', now)).toEqual({ kind: 'reminder', dueAt: now + 600_000, text: 'stretch' });
    expect(parseReminder('Remind me to drink water in 1 hour 30 minutes', now)).toMatchObject({ dueAt: now + 5_400_000, text: 'drink water' });
    expect(parseReminder('set a timer for 5 minutes', now)).toMatchObject({ kind: 'timer', dueAt: now + 300_000 });
    expect(parseReminder('5 minute timer', now)).toMatchObject({ kind: 'timer' });
    expect(new Date((parseReminder('remind me at 5:30pm to call mom', now) as { dueAt: number }).dueAt).getHours()).toBe(17);
    expect(new Date((parseReminder('remind me tomorrow at 9am to send it', now) as { dueAt: number }).dueAt).getDate()).toBe(20);
    expect(parseReminder('remind me in half an hour about the oven', now)).toMatchObject({ dueAt: now + 1_800_000, text: 'the oven' });
    expect(parseReminder('remind me what my favourite colour is', now)).toBeNull();
    expect(parseReminder('what is a volcano?', now)).toBeNull();
    expect(parseReminder('remind me to buy milk', now)).toMatchObject({ error: expect.stringMatching(/with a time/) });
    expect(parseReminder('set a timer for 2 seconds', now)).toMatchObject({ error: expect.stringMatching(/5 seconds/) });
    expect(parseReminder('set a timer for 9 days', now)).toMatchObject({ error: expect.any(String) });
    expect(parseDuration('two hours')).toBe(7_200_000); expect(describeDue(now + 600_000, now)).toMatch(/in 10 minutes/);
  });
  it('[A109] fires when due, flags late ones, snoozes, cancels, and persists', async () => {
    let t = now; const kv = new MemoryKV(); const r = new ReminderStore(kv, () => t); await r.ready;
    const fired: string[] = []; r.onFire = (x) => fired.push(`${x.text}${x.late ? ':late' : ''}`);
    const a = await r.add({ kind: 'reminder', dueAt: now + 60_000, text: 'stretch' });
    const b = await r.add({ kind: 'timer', dueAt: now + 120_000, text: 'tea' });
    await r.add({ kind: 'reminder', dueAt: now + 3_600_000, text: 'later' });
    await r.cancel(b.id);
    t = now + 61_000; await r.tick(); expect(fired).toEqual(['stretch']);
    await r.snooze(a.id, 300_000); expect(r.pending().map((x) => x.text)).toEqual(['stretch', 'later']);
    r.stop();
    // app closed for two hours → on the next start both fire, flagged late
    t = now + 7_200_000; const r2 = new ReminderStore(kv, () => t); await r2.ready; const f2: string[] = []; r2.onFire = (x) => f2.push(`${x.text}${x.late ? ':late' : ''}`);
    await r2.tick(); expect(f2.sort()).toEqual(['later:late', 'stretch:late']); expect(r2.items.find((x) => x.text === 'tea')?.status).toBe('cancelled');
    r2.stop();
  });
});

describe('[A113] compact prompt for small local models', () => {
  it('[A113] is much shorter but keeps the output contract, the robot name and safety rules', () => {
    const req = ChatRequestSchema.parse({ messages: [{ role: 'user', content: 'hi' }], skills: BUILTIN_MOTIONS.map((m) => ({ id: m.id, name: m.name, description: m.description, kind: 'motion', tags: [] })), expressions: BUILTIN_EXPRESSIONS.map((e) => e.id), profile: { robotName: 'Nova' } });
    const full = buildSystemPrompt(req, { streaming: true, sources: [] }); const small = buildSystemPrompt(req, { streaming: true, sources: [], compact: true });
    expect(small.length).toBeLessThan(full.length * 0.5);
    for (const must of ['HEAD', '<<<META>>>', 'Your name is "Nova"', 'approval', 'never claim consciousness']) expect(small).toContain(must);
    expect(full).toContain('Light Markdown is rendered');
  });
});

describe('[A110] new ambient motions', () => {
  it('[A110] every built-in motion (including look_around, stretch, antenna_wiggle) passes the skill validator', () => {
    for (const id of ['look_around', 'stretch', 'antenna_wiggle']) expect(BUILTIN_MOTIONS.some((m) => m.id === id), id).toBe(true);
    for (const m of BUILTIN_MOTIONS) { const v = validateSkill(m); expect(v.report.ok, `${m.id}: ${v.report.errors.map((e) => e.message).join('; ')}`).toBe(true); }
  });
});

describe('[A111] light theme tokens', () => {
  it('[A111] defines a complete light theme whose text colors are readable', () => {
    const css = readFileSync('src/components/styles.css', 'utf8');
    const light = /:root\[data-theme="light"\] \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    for (const v of ['--c-bg', '--c-panel', '--c-text', '--c-muted', '--bg', '--surface', '--fg', '--fg-muted', '--line', '--accent-2', '--header-bg', '--stage-lab']) expect(light, v).toContain(`${v}:`);
    const pick = (name: string) => /#[0-9A-Fa-f]{6}/.exec(new RegExp(`${name}: ([^;]+);`).exec(light)?.[1] ?? '')?.[0];
    expect(contrast('#0B1733', '#FFFFFF')).toBeGreaterThan(12); // --c-text / --fg on white
    expect(contrast('#334155', '#F8FAFC')).toBeGreaterThan(7);  // muted text
    for (const [name, bg] of [['--c-bad', '#FFFFFF'], ['--c-ok', '#FFFFFF'], ['--c-warn', '#FFFFFF'], ['--accent-2', '#F8FAFC']] as const) expect(contrast(pick(name)!, bg), name).toBeGreaterThan(4.5);
  });
});

describe('[A106] [A109] [A103] review fixes (regressions)', () => {
  it('[A106] the Markdown parser always terminates — odd fences and indented headings, plus a 3000-case fuzz', () => {
    for (const t of ['```python title="x"', '````', "```print('hi')```", '  ## Indented heading', '~~~', '>', '-', '1.', '#']) expect(() => parseBlocks(t)).not.toThrow();
    expect(parseBlocks("```print('hi')```")).toEqual([{ t: 'code', lang: '', text: "print('hi')", open: false }]);
    expect(parseBlocks('  ## Indented heading')[0]).toMatchObject({ t: 'h', text: 'Indented heading' });
    const alphabet = ['`', '`', '`', '#', ' ', '\n', '-', '*', '>', '1', '.', '~', 'a', '_', '[', ']', '(', ')', ':', 'h'];
    let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const t0 = Date.now();
    for (let n = 0; n < 3000; n++) { let t = ''; const len = Math.floor(rnd() * 60); for (let i = 0; i < len; i++) t += alphabet[Math.floor(rnd() * alphabet.length)]; renderToStaticMarkup(<Markdown text={t} />); }
    expect(Date.now() - t0).toBeLessThan(5000);
  });
  it('[A109] no false reminders: "9am", "3d printer timer", "pomodoro timer" questions; noon/midnight only with "at"; last "in <time>" wins', () => {
    const now = new Date('2026-10-19T10:00:00').getTime();
    expect(new Date((parseReminder('remind me to check in at 9am', now) as { dueAt: number }).dueAt).getHours()).toBe(9);
    expect(parseReminder('remind me to check in at 9am', now)).toMatchObject({ text: 'check in' });
    expect(new Date((parseReminder('remind me to log in to the 5 m server at 3pm', now) as { dueAt: number }).dueAt).getHours()).toBe(15);
    expect(parseReminder('how do I build a 3d printer timer', now)).toBeNull();
    expect(parseReminder('what is the best 25 minute pomodoro timer', now)).toBeNull();
    expect(parseReminder('set a 10 minute timer', now)).toEqual({ kind: 'timer', dueAt: now + 600_000, text: 'Timer' });
    expect(new Date((parseReminder('remind me about midnight snacks at 4pm', now) as { dueAt: number }).dueAt).getHours()).toBe(16);
    expect(parseReminder('remind me to put the cake in the oven in 5 minutes', now)).toEqual({ kind: 'reminder', dueAt: now + 300_000, text: 'put the cake in the oven' });
    expect(parseReminder('remind me in 2h30m to stop', now)).toMatchObject({ dueAt: now + 9_000_000 });
  });
  it('[A109] "late" means it came due while NEXUS was closed — not just a slow timer', async () => {
    let t = 1_000_000; const kv = new MemoryKV();
    const r = new ReminderStore(kv, () => t); await r.ready; await r.add({ kind: 'reminder', dueAt: t + 60_000, text: 'a' });
    const fired: boolean[] = []; r.onFire = (x) => fired.push(!!x.late);
    t += 4 * 60_000; await r.tick(); r.stop();          // app was open, the check simply ran 3 minutes late (sleep / throttling)
    await r.add({ kind: 'reminder', dueAt: t + 60_000, text: 'b' }); r.stop();
    t += 10 * 60_000; const r2 = new ReminderStore(kv, () => t); await r2.ready; r2.onFire = (x) => fired.push(!!x.late); await r2.tick(); r2.stop();
    expect(fired).toEqual([false, true]);
  });
  it('[A103] names with hidden formatting characters are rejected; emoji with joiners are fine', () => {
    for (const cp of [0x061C, 0xE0041, 0x00AD, 0x200E, 0x2066, 0x200D]) expect(validateRobotName(`No${String.fromCodePoint(cp)}va`).ok, cp.toString(16)).toBe(false);
    expect(validateRobotName('Astro 👩' + String.fromCodePoint(0x200D) + '🚀').ok).toBe(true);
  });
});

describe('[A115] power-saving frame rate', () => {
  it('[A115] the engine reports calm only when nothing visible is happening', async () => {
    const { AnimationEngine, seeded } = await import('../../animation/engine');
    const e = new AnimationEngine(seeded(5));
    let calmSeen = false; for (let i = 0; i < 240; i++) { e.update(1 / 60); if (e.isCalm()) calmSeen = true; }
    expect(calmSeen).toBe(true);
    e.play(BUILTIN_MOTIONS.find((m) => m.id === 'wave')!); e.update(1 / 60);
    expect(e.isCalm()).toBe(false);
    e.setSpeaking(true); e.stopAll(); for (let i = 0; i < 120; i++) e.update(1 / 60);
    expect(e.isCalm()).toBe(false); // speaking keeps the full frame rate (mouth moves)
  });
});
