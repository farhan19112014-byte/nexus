/**
 * Where the Live Vision panel lives (robot view, or the chat in the classic layout). It appears after the user presses a
 * camera button anywhere (visionHost.requestOpen); the camera itself still starts only from "Activate" inside the panel.
 * Unmounting the slot (leaving the page, switching layout) turns the camera off.
 */
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { visionHost } from './host';
import { companion, loadVision } from '../core/runtime';
import type { LiveVision } from './liveVision';

const VisionPanel = lazy(() => import('./VisionPanel'));

export function VisionSlot() {
  const opens = useSyncExternalStore(visionHost.subscribe, visionHost.getOpens);
  // presses before this slot existed (e.g. in the other layout) do not count: a new slot starts closed
  const base = useRef(opens).current;
  const [lv, setLv] = useState<LiveVision | null>(visionHost.instance);
  useEffect(() => {
    if (opens === base || lv) return;
    let gone = false;
    void loadVision().then((v) => { if (!gone) setLv(v); }).catch(() => companion.notifications.push('error', 'Live Vision could not be loaded — check the connection to NEXUS and try again.', { react: false }));
    return () => { gone = true; };
  }, [opens, lv, base]);
  if (!lv) return null;
  return <Suspense fallback={null}><VisionPanel vision={lv} toggle={opens} open={opens !== base} /></Suspense>;
}
