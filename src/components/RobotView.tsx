/**
 * Robot view (default): the robot is the interface. It fills the window; voice is the primary input; the current
 * exchange is shown as captions under the robot (so the app is usable without sound and for screen readers); typing
 * is a compact alternative; everything else (conversation history, skills, memory, settings) opens from the menu.
 */
import { useEffect, useRef, useState } from 'react';
import Stage from './Stage';
import { Message } from './ChatPanel';
import { Icon } from './Icon';
import { companion, memory } from '../core/runtime';
import { useSnapshot, useStore } from './hooks';

export const COMPOSE_EVENT = 'nexus:compose';

export default function RobotView({ onOpenConversation }: { onOpenConversation: () => void }) {
  const snap = useSnapshot(); useStore(memory);
  const s = memory.settings;
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => { const o = () => { setTyping(true); setFocusTick((n) => n + 1); }; window.addEventListener(COMPOSE_EVENT, o); return () => window.removeEventListener(COMPOSE_EVENT, o); }, []);
  useEffect(() => { if (typing) input.current?.focus(); }, [typing, focusTick]);
  // a reviewed voice transcript opens the text box with the words, ready to edit or send
  useEffect(() => { if (snap.draft !== null) { setText(snap.draft); companion.clearDraft(); setTyping(true); setFocusTick((n) => n + 1); } }, [snap.draft]);

  const lastUser = [...snap.messages].reverse().find((m) => m.role === 'user');
  const lastAsst = [...snap.messages].reverse().find((m) => m.role === 'assistant' || m.role === 'system');
  const showAsst = lastAsst && (!lastUser || lastAsst.at >= lastUser.at) ? lastAsst : null;
  const submit = () => { const t = text.trim(); if (!t) return; setText(''); void companion.send(t); };
  const micUnavailable = !companion.stt.supported || snap.mic === 'unsupported';
  const state = snap.state;
  const canPause = state === 'speaking' && !!companion.tts.pause;
  const busyish = snap.busy || snap.speaking || state === 'acting' || state === 'paused';
  const stopAll = () => { if (snap.listening) companion.cancelListening(); companion.stopSpeaking(); companion.stopAction(); if (snap.busy) companion.cancel(); };
  const toggleVoice = () => void memory.updateSettings({ voiceOutput: !s.voiceOutput }).then(() => { companion.applySettings(); if (s.voiceOutput) companion.stopSpeaking(); });

  return (
    <div className="robot-view" data-testid="robot-view">
      <Stage compact />
      <div className="captions" aria-live="polite" data-testid="captions">
        {snap.listening && <p className="cap-interim" role="status"><Icon name="mic" /> {snap.interim || 'Listening…'}</p>}
        {!snap.listening && lastUser && <p className="cap-user"><span className="sr-only">You said: </span>{lastUser.text}</p>}
        {showAsst && <div className="cap-reply"><Message m={showAsst} lastAssistant={!snap.busy} /></div>}
        {!snap.messages.length && !snap.listening && <p className="cap-hint">{micUnavailable ? `Type to talk to ${s.robotName}.` : `Press the microphone and talk to ${s.robotName} — or type.`}</p>}
        {snap.messages.length > 2 && <button className="link small" onClick={onOpenConversation}>Show the whole conversation</button>}
      </div>
      {typing && (
        <form className="type-bar" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <label className="sr-only" htmlFor="composer">Message</label>
          <input id="composer" ref={input} value={text} maxLength={4000} autoComplete="off" placeholder={`Message ${s.robotName}`}
            onChange={(e) => { setText(e.target.value); companion.noteTyping(e.target.value.length > 0); }} onBlur={() => companion.noteTyping(false)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setTyping(false); } }} />
          <button type="submit" className="primary" disabled={!text.trim()} aria-label="Send"><Icon name="send" /></button>
        </form>
      )}
      <div className="dock" role="toolbar" aria-label="Voice controls">
        <button className={`dock-btn${typing ? ' on' : ''}`} onClick={() => { setTyping((v) => !v); setFocusTick((n) => n + 1); }} aria-pressed={typing} aria-label={typing ? 'Hide the text box' : 'Type instead'} title="Type instead (/)"><Icon name="keyboard" size={20} /></button>
        {canPause && <button className="dock-btn" onClick={() => companion.pauseSpeech()} aria-label="Pause speaking" title="Pause"><Icon name="pause" size={20} /></button>}
        {state === 'paused' && <button className="dock-btn" onClick={() => companion.resumeSpeech()} aria-label="Resume speaking" title="Resume"><Icon name="play" size={20} /></button>}
        {snap.listening
          ? <button className="mic-btn listening" onClick={() => companion.stopListening()} aria-pressed="true" aria-label="Stop listening"><Icon name="stop" size={28} /></button>
          : <button className="mic-btn" onClick={() => companion.startListening()} disabled={micUnavailable} aria-label={micUnavailable ? 'Voice input unavailable' : 'Talk'} title={micUnavailable ? (companion.voiceIn?.isDesktop ? 'Voice input in the desktop app needs a transcription service (Settings → Voice)' : 'This browser has no speech recognition') : snap.mic === 'denied' ? 'Microphone blocked — allow it in settings' : 'Talk (asks for microphone permission the first time)'}><Icon name="mic" size={28} /></button>}
        {busyish && <button className="dock-btn" onClick={stopAll} aria-label="Stop" title="Stop (Esc)"><Icon name="close" size={20} /></button>}
        <button className={`dock-btn${s.voiceOutput ? ' on' : ''}`} onClick={toggleVoice} disabled={!companion.tts.supported} aria-pressed={s.voiceOutput} aria-label={s.voiceOutput ? 'Spoken replies on — mute' : 'Spoken replies off — unmute'} title={companion.tts.supported ? 'Spoken replies' : 'No voice available on this system'}><Icon name={s.voiceOutput ? 'speaker' : 'mute'} size={20} /></button>
      </div>
    </div>
  );
}
