/** Chats (saved conversations: search, open, rename, export, delete) and Reminders (timers & reminders) panels. */
import { Icon } from './Icon';
import { useEffect, useState } from 'react';
import { chats, companion, memory, reminders } from '../core/runtime';
import { useSnapshot, useStore } from './hooks';
import { describeDue, parseReminder, type Reminder } from '../core/reminders';
import type { SavedChat } from '../core/chats';

const when = (t: number) => { const d = new Date(t); const today = d.toDateString() === new Date().toDateString(); return today ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };

function download(name: string, text: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function ChatsPanel() {
  useStore(chats); useStore(memory); useSnapshot();
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const s = memory.settings;
  const hits = chats.search(q);
  const exportOne = (c: SavedChat) => download(`${c.title.replace(/[^\w\- ]+/g, '').slice(0, 40).trim() || 'chat'}.md`, chats.toMarkdown(c, s.robotName));
  return (
    <div className="chats-panel">
      <div className="row"><button className="primary" onClick={() => void companion.newChat()}><Icon name="plus" /> New chat</button><span className="spacer" /><span className="muted small">{chats.chats.length} saved</span></div>
      <label className="field">Search chats<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Words from a title or message" /></label>
      {!s.saveChats && <div className="card warn small">Saving chats is off — new conversations are not kept after you close NEXUS. Turn it on in Settings → Privacy.</div>}
      {!hits.length && <p className="muted small">{q ? 'No chats match those words.' : 'No saved chats yet. Your conversations are saved here automatically (only on this computer).'}</p>}
      <ul className="chat-list">
        {hits.map(({ chat, snippet }) => (
          <li key={chat.id} className={chat.id === chats.currentId ? 'current' : ''}>
            {renaming?.id === chat.id
              ? <form className="row" onSubmit={(e) => { e.preventDefault(); void chats.rename(chat.id, renaming.title).then(() => setRenaming(null)); }}>
                  <input aria-label="Chat title" value={renaming.title} maxLength={120} onChange={(e) => setRenaming({ id: chat.id, title: e.target.value })} autoFocus />
                  <button className="primary" type="submit">Save</button><button type="button" onClick={() => setRenaming(null)}>Cancel</button>
                </form>
              : <button className="chat-open" onClick={() => void companion.openChat(chat.id)} aria-current={chat.id === chats.currentId ? 'true' : undefined}>
                  <span className="chat-title">{chat.title}</span>
                  <span className="muted small">{when(chat.updatedAt)} · {chat.messages.length} messages{chat.id === chats.currentId ? ' · open now' : ''}</span>
                  {snippet && <span className="chat-snippet small">{snippet}</span>}
                </button>}
            <div className="row small chat-actions">
              <button className="link" onClick={() => setRenaming({ id: chat.id, title: chat.title })}>rename</button>
              <button className="link" onClick={() => exportOne(chat)}>export</button>
              {confirm === chat.id
                ? <><span className="warn-t">Delete this chat?</span><button className="link danger" onClick={() => { void companion.deleteChat(chat.id); setConfirm(null); }}>yes, delete</button><button className="link" onClick={() => setConfirm(null)}>keep</button></>
                : <button className="link danger" onClick={() => setConfirm(chat.id)}>delete</button>}
            </div>
          </li>
        ))}
      </ul>
      <p className="muted small">Chats are stored only on this computer. Deleting a chat here does not affect copies your AI provider may keep.</p>
    </div>
  );
}

function ReminderRow({ r, now }: { r: Reminder; now: number }) {
  return (
    <li className={`rem rem-${r.status}`}>
      <span className="rem-icon" aria-hidden><Icon name={r.kind === 'timer' ? 'timer' : 'alarm'} size={20} /></span>
      <div className="rem-body">
        <div className="rem-text">{r.text}</div>
        <div className="muted small">{r.status === 'pending' ? describeDue(r.dueAt, now) : `went off ${when(r.firedAt ?? r.dueAt)}${r.late ? ' (late — NEXUS was closed when it was due)' : ''}`}</div>
      </div>
      {r.status === 'pending'
        ? <button onClick={() => void reminders.cancel(r.id)} aria-label={`Cancel ${r.text}`}>Cancel</button>
        : <div className="row"><button onClick={() => void reminders.snooze(r.id)} aria-label={`Snooze ${r.text} for 5 minutes`}>Snooze 5 min</button><button onClick={() => void reminders.dismiss(r.id)} aria-label={`Dismiss ${r.text}`}>Done</button></div>}
    </li>
  );
}

export function RemindersPanel() {
  useStore(reminders); useStore(memory);
  const [now, setNow] = useState(Date.now());
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);
  const pending = reminders.pending(); const fired = reminders.recent().filter((r) => r.status === 'fired');
  const s = memory.settings;
  const add = async () => {
    const t = text.trim(); if (!t) return;
    const phrase = /^(remind|set|start|timer|countdown)\b/i.test(t) || /\btimer$/i.test(t) ? t : `remind me ${t}`;
    const parsed = parseReminder(phrase);
    // the panel only ever creates reminders; text without a time is explained here instead of being sent to the AI
    if (!parsed) { setMsg('I couldn’t find a time in that — try “in 20 minutes to stretch”, “at 6pm to call Mum” or “timer 5 min”.'); return; }
    if ('error' in parsed) { setMsg(parsed.error); return; }
    setText(''); setMsg('');
    await companion.send(phrase);
  };
  return (
    <div className="reminders-panel">
      <form className="row" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <label className="sr-only" htmlFor="rem-input">New reminder</label>
        <input id="rem-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="in 20 minutes to stretch · timer 5 min" />
        <button className="primary" type="submit" disabled={!text.trim()}>Add</button>
      </form>
      <p className="muted small">Or just tell {s.robotName} in the chat, e.g. “remind me at 6pm to call Mum”. Reminders are handled on this device — no AI needed.</p>
      {msg && <p className="small" role="status">{msg}</p>}
      {fired.length > 0 && <><h4>Went off</h4><ul className="rem-list">{fired.map((r) => <ReminderRow key={r.id} r={r} now={now} />)}</ul></>}
      <h4>Upcoming</h4>
      {pending.length ? <ul className="rem-list">{pending.map((r) => <ReminderRow key={r.id} r={r} now={now} />)}</ul> : <p className="muted small">Nothing scheduled.</p>}
      <div className="card small">
        <b>When will I be alerted?</b> While NEXUS is open (in a tab or the desktop app) you get a sound, a message and the robot’s attention.
        Background-tab pop-ups need “desktop notifications” in Settings → Notifications{s.desktopNotifications ? ' (on)' : ' (off)'}. If NEXUS is closed, a missed reminder shows up the next time you open it.
      </div>
      {reminders.items.some((r) => r.status !== 'pending') && <button className="link" onClick={() => void reminders.clearFinished()}>Clear finished</button>}
    </div>
  );
}
