/**
 * Live Vision panel (robot view). Off by default; the camera starts only from the "Activate Live Vision" button, after
 * the user has read what is sent where. While it runs: the local preview, an unmistakable LIVE badge, what NEXUS last
 * saw (with its time), a question box and the answer, and STOP — which ends the camera at once.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '../components/Icon';
import { companion, memory } from '../core/runtime';
import type { LiveVision } from './liveVision';
import { useSnapshot } from '../components/hooks';
import { VISION_LIMITS } from '../../shared/vision';

const ago = (at: number | null, now: number) => { if (!at) return ''; const s = Math.max(0, Math.round((now - at) / 1000)); return s < 5 ? 'just now' : s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`; };

/** Loaded on demand (its own chunk) the first time Live Vision is opened; `vision` is the controller it was loaded with. */
export default function VisionPanel({ vision, open: openInit = true, toggle }: { vision: LiveVision; open?: boolean; toggle: number }) {
  const v = useSyncExternalStore(vision.subscribe, vision.getSnapshot);
  const snap = useSnapshot();
  const [open, setOpen] = useState(openInit);
  const [q, setQ] = useState('');
  const [askedId, setAskedId] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const live = v.status === 'live' || v.status === 'paused' || v.status === 'starting';
  // the dock button: every press after the first toggles the panel (it never turns the camera on by itself)
  const first = useRef(toggle);
  useEffect(() => { if (toggle !== first.current) setOpen((o) => !o); }, [toggle]);
  useEffect(() => { vision.attachVideo(video.current); return () => vision.attachVideo(null); }, [vision, live, open]);
  useEffect(() => { if (!live) return; const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, [live]);
  // leaving the robot page (or closing the app) always turns the camera off
  useEffect(() => () => { if (vision.active) vision.stop(); }, [vision]);
  if (!open && !live && v.status !== 'error') return null;

  const caps = snap.caps?.vision;
  const unavailable = caps ? !caps.available : snap.caps?.provider === 'web-demo' || snap.caps?.provider === 'local-demo';
  const ask = (e: React.FormEvent) => {
    e.preventDefault(); const t = q.trim(); if (!t || !live) return;
    setQ(''); const before = companion.getSnapshot().messages.length;
    void companion.send(t).then(() => {}); // the reply flows through the normal conversation: text, voice, animation
    setTimeout(() => { const m = companion.getSnapshot().messages.slice(before).find((x) => x.role === 'assistant'); if (m) setAskedId(m.id); }, 0);
  };
  const reply = askedId ? snap.messages.find((m) => m.id === askedId) : null;
  const L = v.latest; const stale = L ? now - L.at > VISION_LIMITS.staleMs : false;
  const state = v.status === 'starting' ? 'Waiting for camera permission…' : v.status === 'paused' ? 'Paused while this tab is hidden — nothing is captured.'
    : v.notice ? v.notice : v.analysing ? 'Analysing a frame…' : snap.busy ? 'Answering — observation waits.' : `Observing: one frame about every ${Math.round(v.intervalMs / 1000)} s, only when the view changes.`;

  return (
    <section className={`vision-panel${live ? ' is-live' : ''}`} aria-label="Live Vision" data-testid="vision-panel" data-status={v.status}>
      <header className="vp-head">
        <span className="vision-title"><Icon name="camera" /> Live Vision</span>
        {live && <span className="live-badge" role="status" data-testid="vision-live"><span className="dot" aria-hidden /> LIVE</span>}
        {!live && <button className="icon-btn" onClick={() => { setOpen(false); vision.stop(); }} aria-label="Close Live Vision"><Icon name="close" /></button>}
      </header>

      {!live && (
        <div className="vision-intro">
          <p>NEXUS can look through your camera and answer questions about what it sees.</p>
          <ul className="small muted">
            <li>The camera starts only when you press the button below, and stops the moment you press <b>Stop vision</b>.</li>
            <li>The live preview stays on this device. About every {Math.round(VISION_LIMITS.intervalMs / 1000)} s — only when the view changes — one still frame (640×480 JPEG) is sent to your NEXUS server and on to the AI model ({snap.caps?.label ?? 'the configured model'}) to describe it.</li>
            <li>Nothing is recorded or saved: no video, no images — only short text notes, kept until you stop. NEXUS never identifies people.</li>
            <li>If other people may be in view, ask them first, and keep private documents out of the frame.</li>
          </ul>
          {unavailable && <p className="vision-err" role="alert">{caps?.note ?? 'Live Vision needs the NEXUS server with an AI model that can see images.'}</p>}
          {v.status === 'error' && v.error && <p className="vision-err" role="alert" data-testid="vision-error">{v.error}</p>}
          <button className="primary vision-go" onClick={() => void vision.start()} disabled={unavailable} data-testid="vision-activate">ACTIVATE LIVE VISION</button>
        </div>
      )}

      {live && (
        <>
          <div className="vision-preview">
            <video ref={video} muted playsInline autoPlay aria-label="Your camera (local preview)" />
            <span className="vision-local small">Local preview</span>
          </div>
          <p className="vision-state small" aria-live="polite" data-testid="vision-state">{state}{v.notice && <button className="link small" onClick={() => vision.retry()}> Retry</button>}</p>
          <div className="vision-obs" data-testid="vision-observation">
            {L ? <>
              <p><b>Seen {ago(L.at, now)}</b>{stale && <span className="vision-stale"> · may be out of date</span>}: {L.description}</p>
              {L.objects.length > 0 && <p className="vision-chips">{L.objects.slice(0, 8).map((o) => <span key={o.label + o.position} className="chip-s" title={o.description}>{o.label}</span>)}</p>}
              {L.text.length > 0 && <p className="small">Text: {L.text.map((t) => `“${t}”`).join(', ')}</p>}
              {(L.changes.length > 0 || v.diff.added.length > 0) && <p className="small muted">Changes (the camera may have moved): {L.changes.length ? L.changes.join('; ') : `now also listed: ${v.diff.added.join(', ')}`}</p>}
              {L.uncertainties.length > 0 && <p className="small muted">Unsure: {L.uncertainties.join('; ')}</p>}
            </> : <p className="small muted">{v.notice ? 'No observation yet.' : 'Looking… the first observation takes a few seconds.'}</p>}
          </div>
          <form className="vision-ask" onSubmit={ask}>
            <label className="sr-only" htmlFor="vision-q">Ask about what NEXUS sees</label>
            <input id="vision-q" value={q} onChange={(e) => setQ(e.target.value)} maxLength={300} placeholder={`Ask ${memory.settings.robotName} about the view…`} autoComplete="off" />
            <button type="submit" className="primary" disabled={!q.trim() || snap.busy} aria-label="Ask"><Icon name="send" /></button>
          </form>
          {reply && <p className={`vision-reply${reply.status === 'failed' ? ' failed' : ''}`} data-testid="vision-reply" aria-live="polite">{reply.status === 'failed' ? (reply.error?.message ?? 'The question could not be answered.') : reply.text || '…'}</p>}
          <button className="vision-stop" onClick={() => vision.stop()} data-testid="vision-stop"><Icon name="stop" /> STOP VISION</button>
        </>
      )}
    </section>
  );
}
