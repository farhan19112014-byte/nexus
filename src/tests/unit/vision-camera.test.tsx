// @vitest-environment happy-dom
/** Live Vision: switching cameras (and rolling back on failure), and the minimised panel that keeps a LIVE indicator. */
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { LiveVision } from '../../vision/liveVision';
import VisionPanel from '../../vision/VisionPanel';

const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(200).fill(7)]).toString('base64')}`;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// happy-dom only accepts its own MediaStream class here; the fake streams below are plain objects
Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, get() { return (this as { _so?: unknown })._so ?? null; }, set(x) { (this as { _so?: unknown })._so = x; } });

class Track { stopped = false; constructor(public deviceId: string) {} stop() { this.stopped = true; } addEventListener() {} removeEventListener() {} getSettings() { return { deviceId: this.deviceId }; } }
function rig(o: { failOn?: string[] } = {}) {
  const opened: Track[] = []; const fail = new Set(o.failOn ?? []);
  const v = new LiveVision({
    analyze: async () => ({ observation: { description: 'a desk', objects: [], text: [], changes: [], uncertainties: [], people: 0 }, model: 'm' }),
    busy: () => false, available: () => true, doc: null,
    getUserMedia: async (c) => {
      const want = ((c.video as MediaTrackConstraints).deviceId as { exact?: string } | undefined)?.exact ?? 'back';
      if (fail.has(want)) throw Object.assign(new Error('busy'), { name: 'NotReadableError' });
      const t = new Track(want); opened.push(t);
      return { getTracks: () => [t], getVideoTracks: () => [t] } as unknown as MediaStream;
    },
    enumerateDevices: async () => [
      { kind: 'videoinput', deviceId: 'back', label: 'Back camera' }, { kind: 'audioinput', deviceId: 'mic', label: 'Mic' }, { kind: 'videoinput', deviceId: 'front', label: 'Front camera' },
    ] as MediaDeviceInfo[],
    grab: () => ({ url: JPEG, sig: new Uint8Array(192) }),
  });
  return { v, opened, fail };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('[A150] Live Vision camera switching', () => {
  it('[A150] cameras are listed only after start; switching releases the old camera before opening the next', async () => {
    const r = rig();
    expect(r.v.getSnapshot().cameras).toEqual([]);
    await r.v.start(); await flush();
    expect(r.v.getSnapshot().cameras.map((c) => c.id)).toEqual(['back', 'front']);   // video inputs only
    expect(r.v.getSnapshot().cameraId).toBe('back');
    expect(await r.v.switchCamera()).toBe(true);
    expect(r.opened[0].stopped).toBe(true); expect(r.v.getSnapshot()).toMatchObject({ cameraId: 'front', switching: false, status: 'live' });
    expect(await r.v.switchCamera()).toBe(true); expect(r.v.getSnapshot().cameraId).toBe('back');
    r.v.stop(); expect(r.opened.every((t) => t.stopped)).toBe(true); expect(r.v.getSnapshot().cameras).toEqual([]);
  });
  it('[A150] a camera that cannot open falls back to the previous one with a notice; if that fails too, Live Vision stops', async () => {
    const r = rig({ failOn: ['front'] }); await r.v.start(); await flush();
    expect(await r.v.switchCamera()).toBe(false);
    expect(r.v.getSnapshot()).toMatchObject({ status: 'live', cameraId: 'back', switching: false });
    expect(r.v.getSnapshot().notice).toMatch(/Could not switch to Front camera/);
    r.fail.add('back');
    expect(await r.v.switchCamera()).toBe(false);
    expect(r.v.getSnapshot().status).toBe('error'); expect(r.opened.every((t) => t.stopped)).toBe(true);
  });
  it('[A150] switching is not offered with one camera or while off', async () => {
    const r = rig(); expect(await r.v.switchCamera()).toBe(false); expect(r.opened).toHaveLength(0);
  });
});

describe('[A150] Live Vision panel: back to NEXUS with the camera on', () => {
  it('[A150] Hide shows a compact bar that still says LIVE and can stop the camera', async () => {
    const r = rig(); const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    await act(async () => { root.render(<VisionPanel vision={r.v} toggle={0} />); });
    await act(async () => { await r.v.start(); await flush(); });
    expect(host.querySelector('[data-testid="vision-panel"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="vision-switch"]')).not.toBeNull();
    await act(async () => { (host.querySelector('[data-testid="vision-hide"]') as HTMLButtonElement).click(); });
    expect(host.querySelector('[data-testid="vision-panel"]')).toBeNull();
    expect(host.querySelector('[data-testid="vision-mini"] [data-testid="vision-live"]')).not.toBeNull();
    await act(async () => { (host.querySelector('[data-testid="vision-show"]') as HTMLButtonElement).click(); });
    expect(host.querySelector('[data-testid="vision-panel"]')).not.toBeNull();
    await act(async () => { (host.querySelector('[data-testid="vision-hide"]') as HTMLButtonElement).click(); });
    await act(async () => { (host.querySelector('[data-testid="vision-mini"] [data-testid="vision-stop"]') as HTMLButtonElement).click(); });
    expect(r.v.getSnapshot().status).toBe('off'); expect(r.opened.every((t) => t.stopped)).toBe(true);
    expect(host.querySelector('[data-testid="vision-mini"]')).toBeNull();           // no indicator once the camera is off
    await act(async () => { root.unmount(); }); host.remove();
  });
});
