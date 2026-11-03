/**
 * Audio-reactive bars from measured levels (src/voice/levels.ts): the microphone while NEXUS listens, NEXUS's own
 * server voice while it speaks. With no real levels (browser voice, no mic access) it shows only the state text —
 * never invented bars.
 */
import { useEffect, useState } from 'react';
import { levels, type LevelSource } from '../voice/levels';

const BARS = 32;
export function VoiceScope({ source, label }: { source: LevelSource; label: string }) {
  const [frame, setFrame] = useState<{ live: boolean; h: readonly number[] }>({ live: false, h: [] });
  useEffect(() => {
    let raf = 0;
    const tick = () => { raf = 0; setFrame({ live: levels.live(source), h: [...levels.history(source)] }); };
    const off = levels.subscribe(() => { if (!raf) raf = requestAnimationFrame(tick); });
    const poll = setInterval(tick, 500);   // notice when levels stop arriving
    tick();
    return () => { off(); clearInterval(poll); if (raf) cancelAnimationFrame(raf); };
  }, [source]);
  const h = frame.h.slice(-BARS); const pad = BARS - h.length;
  return (
    <div className={`voice-scope vs-${source}${frame.live ? ' live' : ''}`} data-testid={`voice-scope-${source}`} data-live={frame.live ? '1' : '0'} aria-hidden>
      {frame.live && <div className="vs-bars">{Array.from({ length: BARS }, (_, i) => { const v = i < pad ? 0 : h[i - pad]; return <i key={i} style={{ transform: `scaleY(${Math.max(0.06, v)})` }} />; })}</div>}
      <span className="vs-label">{label}</span>
    </div>
  );
}
