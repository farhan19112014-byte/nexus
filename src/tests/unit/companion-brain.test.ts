/**
 * [A122] master-prompt pass: editable persona, speech-safe text, typed robot events, secret-safe memory, volume.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SpeakableFilter, speakable } from '../../voice/speakable';
import { eventsFor, RobotEvents } from '../../core/robotEvents';
import { StateMachine } from '../../core/stateMachine';
import { looksSensitive } from '../../security/validation';
import { DEFAULT_PERSONA, loadPersona } from '../../../server/prompts/persona';

describe('[A122] persona is stored separately and editable', () => {
  it('[A122] the default persona is the NEXUS instruction; NEXUS_PERSONA_FILE replaces it; bad files fall back with a note', () => {
    expect(DEFAULT_PERSONA).toMatch(/^You are NEXUS, a digital robot companion/); expect(DEFAULT_PERSONA).toMatch(/You are software, not a human/);
    expect(loadPersona({})).toEqual({ text: DEFAULT_PERSONA, source: 'default' });
    const d = mkdtempSync(join(tmpdir(), 'persona-')); const f = join(d, 'p.txt'); writeFileSync(f, 'You are NEXUS, a pirate-themed tutor.\r\n');
    expect(loadPersona({ NEXUS_PERSONA_FILE: f })).toEqual({ text: 'You are NEXUS, a pirate-themed tutor.', source: 'file' });
    const miss = loadPersona({ NEXUS_PERSONA_FILE: join(d, 'nope.txt') }); expect(miss.source).toBe('default'); expect(miss.note).toMatch(/not found/);
    writeFileSync(f, '   '); expect(loadPersona({ NEXUS_PERSONA_FILE: f }).note).toMatch(/empty/);
  });
  it('[A122] the system prompt carries the persona plus the honesty rules that the persona cannot remove', async () => {
    const { buildSystemPrompt } = await import('../../../server/prompts/system');
    const { ChatRequestSchema } = await import('../../../shared/schema');
    const p = buildSystemPrompt(ChatRequestSchema.parse({ messages: [{ role: 'user', content: 'hi' }] }), { streaming: false, sources: [] });
    expect(p).toContain('You are NEXUS, a digital robot companion'); expect(p).toMatch(/Never claim you performed an action/); expect(p).toMatch(/no access to the user's files/);
  });
});

describe('[A122] only speech is spoken', () => {
  it('[A122] markdown, links, citations, inline code and JSON are not read aloud; words stay', () => {
    expect(speakable('**Great** question! See [the docs](https://x.dev/a) or https://y.com/b [1].')).toBe('Great question! See the docs or the link on screen.');
    expect(speakable('## Steps\n- Run `npm start`\n- Open the app')).toBe('Steps. Run npm start. Open the app.');
    expect(speakable('{"reply": "hi", "expression": "happy"}')).toBe('');
    expect(speakable("I'm 100% sure: 3 + 4 = 7.")).toBe("I'm 100% sure: 3 + 4 = 7.");
    expect(speakable('Use `const x = await fetch(url, { method: "POST" })` here.')).toBe('Use here.');
  });
  it('[A122] a code block split across streamed sentences is skipped once, with a short spoken pointer', () => {
    const f = new SpeakableFilter();
    expect(f.next('Here is the fix:\n```ts')).toBe('Here is the fix: The code is on screen.');
    expect(f.next('const a = 1;')).toBe(''); expect(f.next('console.log(a);\n```')).toBe('');
    expect(f.next('That should work.')).toBe('That should work.');
    f.reset(); expect(f.next('```')).toBe('The code is on screen.');
  });
});

describe('[A122] typed robot events follow the one state machine', () => {
  it('[A122] listening → processing → speaking → idle emits the documented events in order; interruption and errors are explicit', () => {
    const sm = new StateMachine(); const ev = new RobotEvents(); ev.attach(sm); const seen: string[] = []; ev.on('*', (e) => seen.push(e.name));
    let thrown = 0; ev.on('onSpeechStart', () => { thrown++; throw new Error('bad listener'); });   // a broken listener cannot break the robot
    sm.go('listening'); sm.go('processing'); sm.go('speaking'); sm.go('idle');
    expect(seen).toEqual(['onListeningStart', 'onProcessingStart', 'onResponseReceived', 'onSpeechStart', 'onSpeechEnd']); expect(thrown).toBe(1);
    seen.length = 0; sm.go('processing'); sm.go('speaking'); sm.go('interrupted'); sm.go('idle');
    expect(seen).toEqual(['onProcessingStart', 'onResponseReceived', 'onSpeechStart', 'onSpeechInterrupted']);
    expect(eventsFor('processing', 'error')).toEqual(['onError']); expect(eventsFor('speaking', 'paused')).toEqual([]); expect(eventsFor('paused', 'speaking')).toEqual([]);
    expect(eventsFor('speaking', 'listening')).toEqual(['onListeningStart', 'onSpeechInterrupted']);
  });
});

describe('[A122] secrets never become memories', () => {
  it('[A122] API keys and tokens are recognised as sensitive', () => {
    for (const t of ['my key is AIzaSyD-1234567890abcdefghijklmnop', 'sk_0123456789abcdef0123456789abcdef', 'token: eyJhbGciOiJIUzI1NiIsInR5cCI6', 'my password is hunter2']) expect(looksSensitive(t), t).toBe(true);
    expect(looksSensitive('I like short answers and robots')).toBe(false);
  });
});
