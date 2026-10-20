/** Assets 85/86 — conversation: history with status & timestamps, streaming, retry, cancel, sources, consent prompts, proposals, disclosures. */
import { Icon } from './Icon';
import { useEffect, useRef, useState } from 'react';
import { companion, memory, registry } from '../core/runtime';
import { fmtTime, useSnapshot, useStore } from './hooks';
import type { UIMessage } from '../ai/context';
import { Markdown } from './Markdown';
import { chats } from '../core/runtime';

const SUGGEST = ['Hello!', 'Wave then nod', 'Invent a new greeting', 'Invent a new expression', 'Can you wave more casually?', 'Sit down', 'What can you do?'];
const SCOPE_LABEL: Record<string, string> = { conversation: 'Conversation only', memory: 'Memory', skill_registry: 'Skill registry', preference: 'Preference', retrieval: 'Retrieval' };

function Proposal({ m }: { m: UIMessage }) {
  useStore(registry);
  const l = m.learn; if (!l?.skillId || !l.version) return null;
  const v = registry.getVersion(l.skillId, l.version);
  if (!v) return null;
  return (
    <div className={`card proposal st-${v.status}`}>
      <div><b>{(v.def as { name: string }).name}</b> <span className={`badge b-${v.status}`}>{v.status}</span> <span className="muted">{v.kind} · v{v.version}</span></div>
      {v.status === 'proposed' && (
        <div className="row">
          <button onClick={() => companion.previewSkill(l.skillId!, l.version)}><Icon name="eye" /> Preview</button>
          <button className="primary" onClick={() => void companion.approve(l.skillId!, l.version!)}>Approve</button>
          <button className="danger" onClick={() => void companion.reject(l.skillId!, l.version!)}>Reject</button>
        </div>
      )}
      {v.status === 'approved' && <button onClick={() => void companion.playSkill(l.skillId!)}><Icon name="play" /> Play</button>}
    </div>
  );
}

export function Message({ m, lastUser, lastAssistant, onEdit }: { m: UIMessage; lastUser?: boolean; lastAssistant?: boolean; onEdit?: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(m.text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { companion.notifications.push('error', 'Copy failed — your browser blocked clipboard access.'); } };
  const [open, setOpen] = useState(false);
  useStore(memory);
  if (m.role === 'system') return <div className="msg system">{m.text}</div>;
  const r = m.response; const meta = m.meta;
  const sugg = memory.suggestions.filter((s) => m.changes?.some((c) => c.text.includes(s.text)));
  return (
    <article className={`msg ${m.role} ms-${m.status}`} aria-busy={m.status === 'streaming' || m.status === 'sending'}>
      <div className="bubble">
        {m.role === 'assistant' && m.text ? <Markdown text={m.text} /> : m.text || (m.status === 'sending' ? <span className="typing" aria-label={m.stage === 'researching' ? 'Researching' : 'Waiting for the AI'}><i /><i /><i /> {m.stage === 'researching' ? 'researching…' : ''}</span> : m.status === 'cancelled' ? <em>cancelled before any reply</em> : '')}
        {m.status === 'streaming' && <span className="cursor" aria-hidden>▍</span>}
      </div>
      <div className="msg-meta">
        <time dateTime={new Date(m.at).toISOString()}>{fmtTime(m.at)}</time>
        {m.role === 'assistant' && m.status === 'complete' && meta && (meta.provider === 'on-device'
          ? <span>handled on this device · no AI</span>
          : <span>{meta.isLLM ? `LLM · ${meta.model ?? meta.provider}` : meta.provider === 'local-demo' ? 'local demo brain' : 'demo brain (not an LLM)'}{meta.streamed ? ' · streamed' : ''}{meta.promptMode === 'compact' ? ' · compact prompt' : ''} · {(meta.latencyMs / 1000).toFixed(1)}s</span>)}
        {m.status === 'cancelled' && <span className="warn-t">cancelled — not a complete answer</span>}
        {m.status === 'failed' && <span className="err">failed</span>}
        {m.text && m.status !== 'sending' && m.status !== 'streaming' && <button className="link" onClick={() => void copy()} aria-label="Copy message">{copied ? 'copied' : 'copy'}</button>}
        {lastAssistant && m.replyTo && (m.status === 'complete' || m.status === 'cancelled') && meta?.provider !== 'on-device' && <button className="link" onClick={() => void companion.regenerate()} aria-label="Regenerate reply" disabled={companion.getSnapshot().busy}><Icon name="retry" /> regenerate</button>}
        {m.role === 'assistant' && m.text && (m.status === 'complete' || m.status === 'cancelled') && companion.tts.supported && <button className="link" onClick={() => companion.readAloud(m.text)} title="Read this reply aloud"><Icon name="play" /> read aloud</button>}
        {lastUser && onEdit && <button className="link" onClick={onEdit} aria-label="Edit your last message"><Icon name="pen" /> edit</button>}
        {m.role === 'assistant' && m.status === 'complete' && meta?.provider !== 'on-device' && <span className="fresh">{m.sources?.length ? `Uses ${m.sources.length} source(s) retrieved ${fmtTime(Date.parse(m.sources[0].retrievedAt))}` : 'Model background knowledge (not live-verified)'}</span>}
        {r && r.uncertainty !== 'low' && <span className="warn-t">uncertainty: {r.uncertainty}</span>}
      </div>
      {m.error && (
        <div className="card error" role="alert">
          {m.error.message}
          {m.error.retryable && <button onClick={() => void companion.retry(m.id)}><Icon name="retry" /> Retry</button>}
          {m.error.code === 'offline' && <button onClick={() => void companion.answerWithOfflineDemo(m.id)} title="Scripted answer from this browser — not an AI">Answer with the offline demo (not an AI)</button>}
        </div>
      )}
      {m.sources && m.sources.length > 0 && (
        <details className="sources" open={m.status === 'complete'}>
          <summary>Sources ({m.sources.length}) — retrieved via {m.sources[0].provider}</summary>
          <ol>{m.sources.map((s) => <li key={s.id} className={r?.citations.includes(s.id) ? 'cited' : ''}><a href={s.url} target="_blank" rel="noreferrer noopener">{s.title}</a> <span className="muted">[{s.id}] · retrieved {new Date(s.retrievedAt).toLocaleString()}{s.publishedAt ? ` · published ${s.publishedAt.slice(0, 10)}` : ''}{r?.citations.includes(s.id) ? ' · cited' : ''}</span><p>{s.snippet.slice(0, 280)}{s.snippet.length > 280 ? '…' : ''}</p></li>)}</ol>
        </details>
      )}
      {r?.clarification && <div className="card clar"><Icon name="help" /> {r.clarification}</div>}
      {sugg.map((s) => (
        <div key={s.id} className="card consent" role="group" aria-label="Memory suggestion">
          <div>Remember this? <b>“{s.text}”</b> <span className="muted">({s.category}{s.reason ? ` — ${s.reason}` : ''})</span></div>
          <div className="row"><button className="primary" onClick={() => void companion.acceptSuggestion(s.id)}>Save to memory</button><button onClick={() => memory.dismissSuggestion(s.id)}>No thanks</button></div>
        </div>
      ))}
      {m.learn && <Proposal m={m} />}
      {(m.changes?.length || m.notes?.length) ? (
        <div className="disclosure">
          <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>What changed? {open ? '▴' : '▾'}</button>
          {open && (
            <ul>
              {m.changes?.map((c, i) => <li key={i}><span className={`scope sc-${c.scope}`}>{SCOPE_LABEL[c.scope]}</span> {c.text}</li>)}
              {m.notes?.map((n, i) => <li key={`n${i}`} className="muted">• {n}</li>)}
              <li className="muted">The language model itself was not trained or changed.</li>
            </ul>
          )}
        </div>
      ) : null}
    </article>
  );
}

export default function ChatPanel({ inDrawer = false }: { inDrawer?: boolean } = {}) {
  const snap = useSnapshot(); useStore(memory);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<string | null>(null); // id of the message being edited
  useStore(chats);
  const chatId = chats.currentId;
  useEffect(() => { setEditing(null); }, [chatId]); // switching chats ends edit mode
  const list = useRef<HTMLDivElement>(null); const input = useRef<HTMLTextAreaElement>(null);
  const last = snap.messages.at(-1);
  useEffect(() => { const el = list.current; if (!el) return; const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160; if (nearBottom) el.scrollTop = el.scrollHeight; }, [snap.messages.length, last?.text]);
  useEffect(() => { if (snap.draft !== null) { setText(snap.draft); companion.clearDraft(); input.current?.focus(); } }, [snap.draft]);
  const submit = () => { const t = text.trim(); if (!t) return; setText(''); if (editing) { const id = editing; setEditing(null); void companion.editLast(t, id).then((ok) => { if (!ok) void companion.send(t); }); } else void companion.send(t); };
  const lastUserId = [...snap.messages].reverse().find((m) => m.role === 'user')?.id;
  const lastAsstId = [...snap.messages].reverse().find((m) => m.role === 'assistant')?.id;
  const startEdit = () => { const u = snap.messages.find((m) => m.id === lastUserId); if (!u) return; setText(u.text); setEditing(u.id); requestAnimationFrame(() => input.current?.focus()); };
  const exportChat = () => {
    const c = chats.current; if (!c) { companion.notifications.push('info', 'Nothing to export yet — send a message first (and keep "save chats" on).', { react: false }); return; }
    const blob = new Blob([chats.toMarkdown(c, s.robotName)], { type: 'text/markdown' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${c.title.replace(/[^\w\- ]+/g, '').slice(0, 40).trim() || 'chat'}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const s = memory.settings;
  const micLabel = !snap.capabilities.find((c) => c.id === 'stt') || snap.mic === 'unsupported' ? 'unsupported' : snap.mic;
  return (
    <div className="chat">
      <div className="messages" ref={list} role="log" aria-live="polite" aria-relevant="additions text">
        {!snap.messages.length && (
          <div className="empty">
            <p>Say hi to {s.robotName} — type, or press the microphone. Try:</p>
            <div className="chips">{SUGGEST.map((x) => <button key={x} onClick={() => void companion.send(x)}>{x}</button>)}</div>
          </div>
        )}
        {snap.messages.map((m) => <Message key={m.id} m={m} lastUser={m.id === lastUserId && !snap.busy} lastAssistant={m.id === lastAsstId && !snap.busy} onEdit={startEdit} />)}
      </div>
      {snap.listening && <div className="interim" role="status"><Icon name="mic" /> {snap.interim || 'Listening…'} <button className="link" onClick={() => companion.cancelListening()}>cancel</button></div>}
      <div className="quick-actions" role="toolbar" aria-label="Quick actions">
        <button onClick={() => void companion.newChat()} title="Start a new chat (this one stays in Chats)"><Icon name="plus" /> New chat</button>
        <button onClick={() => { setText('Remind me in 10 minutes to '); requestAnimationFrame(() => { const el = input.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }); }} title="Reminders are handled on this device"><Icon name="alarm" /> Reminder</button>
        <button onClick={() => { setText('Set a timer for 5 minutes'); requestAnimationFrame(() => input.current?.focus()); }}><Icon name="timer" /> Timer</button>
        <button onClick={exportChat} title="Download this chat as a Markdown file"><Icon name="download" /> Export</button>
      </div>
      {editing && <div className="editing-bar small" role="status">Editing your last message — sending replaces it and the reply after it. <button className="link" onClick={() => { setEditing(null); setText(''); }}>cancel edit</button></div>}
      <div className="composer">
        <label className="sr-only" htmlFor={inDrawer ? 'composer-full' : 'composer'}>Message</label>
        <textarea id={inDrawer ? 'composer-full' : 'composer'} ref={input} value={text} rows={2} maxLength={4000} aria-label="Message"
          placeholder={snap.listening ? 'Listening…' : `Message ${s.robotName} — Enter to send, Shift+Enter for a new line`}
          onChange={(e) => { setText(e.target.value); companion.noteTyping(e.target.value.length > 0); }}
          onBlur={() => companion.noteTyping(false)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
        <div className="row wrap">
          <button className="primary" onClick={submit} disabled={!text.trim()}>Send</button>
          {snap.listening
            ? <button className="danger" onClick={() => companion.stopListening()} aria-pressed><Icon name="stop" /> Stop listening</button>
            : <button onClick={() => companion.startListening()} disabled={micLabel === 'unsupported'} title={micLabel === 'denied' ? 'Microphone blocked — allow it in site settings' : 'Speak (asks for microphone permission the first time)'}><Icon name="mic" /> Speak</button>}
          {snap.busy && <button onClick={() => companion.cancel()}><Icon name="close" /> Cancel</button>}
          {snap.speaking && <button onClick={() => companion.stopSpeaking()}><Icon name="mute" /> Stop speaking</button>}
          <span className="spacer" />
          <span className={`mic mic-${micLabel}`} title="Microphone permission">mic: {micLabel}</span>
        </div>
        <div className="row wrap small">
          <label className="toggle"><input type="checkbox" checked={s.voiceOutput} disabled={!companion.tts.supported} onChange={(e) => void memory.updateSettings({ voiceOutput: e.target.checked }).then(() => companion.applySettings())} /> Spoken replies{companion.tts.supported ? '' : ' (unsupported)'}</label>
          <label className="toggle" title={snap.caps?.research.configured ? 'Retrieve live sources for each message' : snap.caps?.research.note}><input type="checkbox" checked={s.research} onChange={(e) => void memory.updateSettings({ research: e.target.checked })} /> Research{snap.caps?.research.configured ? ` (${snap.caps.research.provider})` : ' (not configured)'}</label>
          <label className="toggle"><input type="checkbox" checked={s.reviewTranscript} onChange={(e) => void memory.updateSettings({ reviewTranscript: e.target.checked })} /> Review voice text before sending</label>
          <span className="spacer" />
          <button className="link" onClick={() => void companion.newChat()}>New chat</button>
        </div>
      </div>
    </div>
  );
}
