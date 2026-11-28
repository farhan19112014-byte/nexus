/**
 * NEXUS Live Vision — browser side.
 *
 *  camera (getUserMedia, only after the user presses "Activate") → <video> preview (local only)
 *  → every `intervalMs` one frame is drawn to a 640×480 canvas, compressed to JPEG and — only if the view changed or the
 *    last observation is getting old — sent to the NEXUS server (/api/vision/analyze) → the AI model → a validated
 *    observation (text) → the ObservationManager (latest + previous only).
 *  A question asked while Live Vision is on takes a FRESH frame and goes through the normal conversation (chat → reply →
 *  voice → animation); background observation pauses for it.
 *
 * Guarantees: at most ONE analysis in flight (a tick that finds one running is skipped — no queue); nothing is captured or
 * sent while off, while the tab is hidden, or while NEXUS is answering; Stop ends every camera track, aborts the request
 * in flight, empties the canvas and forgets the observations. Frames are never stored — only short text observations.
 */
import { labelDiff, observationText, VISION_LIMITS, type TimedObservation, type VisionChatContext, type VisionObservation } from '../../shared/vision';

export type VisionStatus = 'off' | 'starting' | 'live' | 'paused' | 'error';
export interface VisionConfig { intervalMs: number; width: number; height: number; quality: number; staleMs: number; maxIntervalMs: number }
export interface VisionDeps {
  /** POST /api/vision/analyze (through the existing API client); throws ApiError-like {message, code, retryable} */
  analyze: (body: { image: string; previous: string }, signal: AbortSignal) => Promise<unknown>;
  /** true while NEXUS is answering a question: background observation waits */
  busy: () => boolean;
  /** the server can analyse frames (capabilities); null = unknown */
  available: () => boolean | null;
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
  /** lists cameras (labels are only filled in after permission was granted) */
  enumerateDevices?: () => Promise<MediaDeviceInfo[]>;
  now?: () => number;
  doc?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> | null;
  /** tests: replaces the canvas capture */
  grab?: () => { url: string; sig: Uint8Array } | null;
}
export interface VisionCamera { id: string; label: string }
export interface VisionSnapshot {
  status: VisionStatus; error: string | null;
  /** cameras on this device (after permission) and the one in use — for "Switch camera" */
  cameras: VisionCamera[]; cameraId: string | null; switching: boolean;
  /** why automatic observation is paused while the camera stays on (quota, server problem…) */
  notice: string | null;
  analysing: boolean; latest: TimedObservation | null; previous: TimedObservation | null;
  /** cautious list comparison between the two newest observations */
  diff: { added: string[]; gone: string[] };
  framesSent: number; framesSkipped: number; intervalMs: number; lastAnalysisAt: number | null;
}

/**
 * Keeps only what the current session needs, as text (never images): the newest observation, the one before it, and up
 * to `EARLIER_SCENES` earlier views that differed clearly from what followed (the camera was pointed elsewhere) — so a
 * follow-up like "what about the one I showed you before?" can be resolved. Everything is forgotten when Live Vision stops.
 */
export const EARLIER_SCENES = 3;
export class ObservationManager {
  latest: TimedObservation | null = null; previous: TimedObservation | null = null;
  /** earlier, clearly different views, newest first (excludes `latest` and `previous`) */
  earlier: TimedObservation[] = [];
  push(o: VisionObservation, at: number, model: string | null) {
    const next = { ...o, at, model };
    // the view about to drop out of `previous` is kept only if it was a different scene from its successor
    if (this.previous && this.latest && differentScene(this.previous, this.latest)) this.earlier = [this.previous, ...this.earlier].slice(0, EARLIER_SCENES);
    this.previous = this.latest; this.latest = next;
  }
  clear() { this.latest = null; this.previous = null; this.earlier = []; }
  ageMs(now: number) { return this.latest ? now - this.latest.at : null; }
  /** the notes a chat question carries (newest first, short) */
  notes(now: number): string {
    const ago = (o: TimedObservation) => `${Math.max(0, Math.round((now - o.at) / 1000))} s ago`;
    const fmt = (o: TimedObservation, label: string) => `${label} (${ago(o)}): ${observationText(o)}${o.changes.length ? ` Changes noted: ${o.changes.join('; ')}.` : ''}`;
    const brief = (o: TimedObservation) => `Earlier view (${ago(o)}, may no longer be in view): ${o.description}${o.objects.length ? ` Objects: ${o.objects.map((x) => x.label).join(', ')}.` : ''}`;
    const lines = [this.latest && fmt(this.latest, 'Newest observation'), this.previous && fmt(this.previous, 'Previous observation'), ...this.earlier.map(brief)].filter(Boolean) as string[];
    // the newest lines always fit; older ones are dropped whole rather than cut mid-sentence
    let out = '';
    for (const l of lines) { const n = out ? `${out}\n${l}` : l; if (n.length > 2900) { if (!out) out = l.slice(0, 2900); break; } out = n; }
    return out;
  }
}

/** Two observations show different scenes when their object lists barely overlap (a list comparison, not motion detection). */
export function differentScene(a: VisionObservation, b: VisionObservation): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/^(a|an|the)\s+/, '').replace(/s$/, '').trim();
  const x = new Set(a.objects.map((o) => norm(o.label))); const y = new Set(b.objects.map((o) => norm(o.label)));
  if (!x.size || !y.size) return false;
  const both = [...x].filter((l) => y.has(l)).length;
  return both / new Set([...x, ...y]).size < 0.4;
}

const errInfo = (e: unknown) => { const x = e as { message?: string; code?: string; retryable?: boolean; name?: string }; return { message: String(x?.message ?? 'The analysis failed.'), code: String(x?.code ?? (x?.name === 'AbortError' ? 'cancelled' : 'provider')), retryable: !!x?.retryable }; };

export class LiveVision {
  readonly obs = new ObservationManager();
  config: VisionConfig = { intervalMs: VISION_LIMITS.intervalMs, width: VISION_LIMITS.width, height: VISION_LIMITS.height, quality: VISION_LIMITS.jpegQuality, staleMs: VISION_LIMITS.staleMs, maxIntervalMs: VISION_LIMITS.maxIntervalMs };
  private snap: VisionSnapshot = this.fresh();
  private listeners = new Set<() => void>();
  private stream: MediaStream | null = null; private video: HTMLVideoElement | null = null; private canvas: HTMLCanvasElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null; private ctl: AbortController | null = null; private session = 0;
  private interval = VISION_LIMITS.intervalMs; private lastSig: Uint8Array | null = null; private lastSentAt = 0;
  private autoPaused = false;
  private now: () => number; private doc: VisionDeps['doc'];
  constructor(private d: VisionDeps) {
    this.now = d.now ?? (() => Date.now());
    this.doc = d.doc === undefined ? (typeof document !== 'undefined' ? document : null) : d.doc;
  }
  private fresh(): VisionSnapshot { return { status: 'off', error: null, cameras: [], cameraId: null, switching: false, notice: null, analysing: false, latest: null, previous: null, diff: { added: [], gone: [] }, framesSent: 0, framesSkipped: 0, intervalMs: VISION_LIMITS.intervalMs, lastAnalysisAt: null }; }
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  getSnapshot = () => this.snap;
  private set(p: Partial<VisionSnapshot>) { this.snap = { ...this.snap, ...p }; this.listeners.forEach((f) => f()); }
  get active() { return this.snap.status === 'live' || this.snap.status === 'paused' || this.snap.status === 'starting'; }

  /** Asks for the camera (only ever called from the user's "Activate" press). */
  async start(): Promise<boolean> {
    if (this.active) return true;
    const s = ++this.session;
    const gum = this.gum();
    if (typeof window !== 'undefined' && window.isSecureContext === false) { this.set({ status: 'error', error: 'The camera only works on a secure page (https:// or this computer\'s localhost).' }); return false; }
    if (!gum) { this.set({ status: 'error', error: 'This browser cannot use a camera here (no camera support).' }); return false; }
    this.set({ ...this.fresh(), status: 'starting' });
    let stream: MediaStream;
    try { stream = await gum(this.constraints(null)); }
    catch (e) {
      if (s !== this.session) return false;
      this.set({ status: 'error', error: cameraError(e) }); return false;
    }
    if (s !== this.session) { stream.getTracks().forEach((t) => t.stop()); return false; }   // stopped while the permission prompt was open
    this.useStream(stream);
    this.interval = this.config.intervalMs; this.autoPaused = false;
    this.doc?.addEventListener('visibilitychange', this.onVis);
    this.set({ status: this.doc?.hidden ? 'paused' : 'live', error: null, intervalMs: this.interval });
    this.schedule(800);   // the first frame shortly after the preview starts
    void this.listCameras(s);
    return true;
  }

  private gum(): ((c: MediaStreamConstraints) => Promise<MediaStream>) | null {
    return this.d.getUserMedia ?? (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia ? (c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c) : null);
  }
  /** the first camera: the rear one where there is a choice (phones); a chosen camera: exactly that one */
  private constraints(deviceId: string | null): MediaStreamConstraints {
    return { audio: false, video: { width: { ideal: this.config.width }, height: { ideal: this.config.height }, ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }) } };
  }
  private useStream(stream: MediaStream) {
    this.stream = stream;
    for (const t of stream.getVideoTracks()) t.addEventListener('ended', this.onEnded);
    if (this.video) this.bindVideo(this.video);
    const id = stream.getVideoTracks()[0]?.getSettings?.().deviceId ?? null;
    this.set({ cameraId: id });
  }
  private releaseStream() {
    if (this.stream) { for (const t of this.stream.getTracks()) { t.removeEventListener('ended', this.onEnded); t.stop(); } }
    this.stream = null;
  }
  /** Cameras on this device (labels exist only now that permission was given). Never opens a camera itself. */
  private async listCameras(s: number) {
    const en = this.d.enumerateDevices ?? (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices ? () => navigator.mediaDevices.enumerateDevices() : null);
    if (!en) return;
    try {
      const all = (await en()).filter((d) => d.kind === 'videoinput' && d.deviceId);
      if (s !== this.session) return;
      this.set({ cameras: all.map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` })) });
    } catch { /* no list: switching simply is not offered */ }
  }

  /**
   * Switch to the next camera (front ↔ back on a phone, built-in ↔ USB webcam on a laptop). The old camera is released
   * first (many phones cannot open two at once); if the new one fails, the previous one is reopened, else Live Vision stops.
   */
  async switchCamera(): Promise<boolean> {
    const list = this.snap.cameras; const gum = this.gum();
    if (!this.active || this.snap.status === 'starting' || this.snap.switching || list.length < 2 || !gum) return false;
    const s = this.session; const prev = this.snap.cameraId;
    const next = list[(list.findIndex((c) => c.id === prev) + 1) % list.length];
    this.ctl?.abort('switch'); this.ctl = null;
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    this.releaseStream(); this.lastSig = null;
    this.set({ switching: true, analysing: false });
    const open = async (id: string | null) => { const st = await gum(this.constraints(id)); if (s !== this.session) { st.getTracks().forEach((t) => t.stop()); return null; } return st; };
    let stream: MediaStream | null = null; let ok = true;
    try { stream = await open(next.id); }
    catch (e) {
      ok = false;
      if (s !== this.session) return false;
      try { stream = await open(prev); } catch { if (s === this.session) this.stop(`Could not switch camera (${cameraError(e)}) and the previous camera could not be reopened.`); return false; }
      if (stream) this.set({ notice: `Could not switch to ${next.label}: ${cameraError(e)}` });
    }
    if (!stream || s !== this.session) return false;
    this.useStream(stream);
    this.set({ switching: false });
    this.schedule(600);
    return ok;
  }

  /** Stops everything at once: tracks, timer, request in flight, canvas, observations. */
  stop(reason: string | null = null) {
    this.session++;
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    this.ctl?.abort('stopped'); this.ctl = null;
    this.releaseStream();
    if (this.video) { try { this.video.pause(); } catch { /* gone */ } this.video.srcObject = null; }
    if (this.canvas) { this.canvas.width = 0; this.canvas.height = 0; } this.canvas = null;
    this.lastSig = null; this.obs.clear();
    this.doc?.removeEventListener('visibilitychange', this.onVis);
    this.set({ ...this.fresh(), status: reason ? 'error' : 'off', error: reason });
  }

  /** The preview element (the UI mounts it); the stream is shown locally and never uploaded as video. */
  attachVideo(el: HTMLVideoElement | null) { this.video = el; if (el && this.stream) this.bindVideo(el); }
  private bindVideo(el: HTMLVideoElement) { el.muted = true; el.playsInline = true; if (el.srcObject !== this.stream) el.srcObject = this.stream; void el.play?.().catch(() => {}); }

  private onEnded = () => { if (this.active) this.stop('The camera was disconnected or turned off. Live Vision has stopped.'); };
  private onVis = () => {
    if (!this.active) return;
    if (this.doc?.hidden) { this.ctl?.abort('hidden'); this.set({ status: 'paused', analysing: false }); }
    else { this.set({ status: 'live' }); this.schedule(500); }
  };
  private schedule(ms = this.interval) { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => { this.timer = null; void this.tick(); }, ms); }

  /** Resume automatic observation after a pause for a server problem (user pressed Retry). */
  retry() { if (!this.active) return; this.autoPaused = false; this.interval = this.config.intervalMs; this.set({ notice: null, intervalMs: this.interval }); this.schedule(100); }

  /** One sampling step. Never queues: a tick that finds a request in flight (or NEXUS answering) just waits for the next. */
  async tick(): Promise<'sent' | 'skipped' | 'idle'> {
    if (!this.active) return 'idle';
    const again = () => { if (this.active) this.schedule(); };
    if (this.snap.status !== 'live' || this.doc?.hidden || this.autoPaused) { again(); return 'idle'; }
    if (this.ctl || this.d.busy() || this.d.available() === false) { this.set({ framesSkipped: this.snap.framesSkipped + 1 }); again(); return 'skipped'; }
    const frame = this.capture();
    if (!frame) { again(); return 'skipped'; }
    // the view has not changed and the newest observation is still fresh: no request at all
    const age = this.obs.ageMs(this.now());
    if (this.lastSig && similar(this.lastSig, frame.sig) && age !== null && age < this.config.staleMs * 0.8) { this.set({ framesSkipped: this.snap.framesSkipped + 1 }); again(); return 'skipped'; }
    const s = this.session; const ctl = new AbortController(); this.ctl = ctl; const t0 = this.now();
    this.set({ analysing: true, framesSent: this.snap.framesSent + 1 }); this.lastSentAt = t0;
    try {
      const r = await this.d.analyze({ image: frame.url, previous: this.obs.latest ? observationText(this.obs.latest) : '' }, ctl.signal) as { observation?: VisionObservation; at?: number; model?: string | null };
      if (s !== this.session || ctl.signal.aborted) return 'idle';
      if (!r?.observation?.description) throw Object.assign(new Error('The server answered without an observation.'), { code: 'malformed', retryable: true });
      this.obs.push(r.observation, this.now(), r.model ?? null); this.lastSig = frame.sig;
      // slower answers → slower sampling (never more than one in flight anyway); fast answers → back toward the setting
      const took = this.now() - t0; this.interval = Math.min(this.config.maxIntervalMs, Math.max(this.config.intervalMs, Math.round(took * 1.5)));
      this.set({ latest: this.obs.latest, previous: this.obs.previous, diff: labelDiff(this.obs.previous, r.observation), lastAnalysisAt: this.now(), error: null, notice: null, intervalMs: this.interval });
    } catch (e) {
      if (s !== this.session || ctl.signal.aborted) return 'idle';
      const x = errInfo(e);
      if (x.code === 'unconfigured' || x.code === 'quota' || x.code === 'invalid_request') { this.autoPaused = true; this.set({ notice: x.message }); }
      else { this.interval = Math.min(this.config.maxIntervalMs, this.interval * 2); this.set({ notice: `The last frame could not be analysed: ${x.message} Trying again in ${Math.round(this.interval / 1000)} s.`, intervalMs: this.interval }); }
    } finally {
      if (this.ctl === ctl) this.ctl = null;
      if (s === this.session) { this.set({ analysing: false }); again(); }
    }
    return 'sent';
  }

  /** A 640×480 (or smaller, same aspect) JPEG of the current preview, plus a tiny grey signature to notice "no change". */
  capture(): { url: string; sig: Uint8Array } | null {
    if (this.d.grab) return this.stream ? this.d.grab() : null;
    const v = this.video; if (!v || !this.stream || v.readyState < 2 || !v.videoWidth) return null;
    const k = Math.min(1, this.config.width / v.videoWidth, this.config.height / v.videoHeight);
    const w = Math.max(1, Math.round(v.videoWidth * k)), h = Math.max(1, Math.round(v.videoHeight * k));
    const c = this.canvas ??= document.createElement('canvas'); if (c.width !== w) c.width = w; if (c.height !== h) c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true }); if (!g) return null;
    g.drawImage(v, 0, 0, w, h);
    const url = c.toDataURL('image/jpeg', this.config.quality);
    return { url, sig: signature(g, w, h) };
  }

  /**
   * What a question asked now carries: a fresh frame (when the camera is live) and the recent observations as text.
   * Background analysis in flight is cancelled — the question has priority.
   */
  forQuestion(): VisionChatContext | null {
    if (!this.active) return null;
    this.ctl?.abort('question'); this.ctl = null; this.set({ analysing: false });
    const now = this.now();
    const frame = this.snap.status === 'live' ? this.capture() : null;
    const age = this.obs.ageMs(now);
    return { ...(frame ? { frame: frame.url } : {}), notes: this.obs.notes(now), ageS: frame ? 0 : age === null ? null : age / 1000 };
  }
  /** tests: how many requests are in flight right now (0 or 1) */
  get inFlight() { return this.ctl ? 1 : 0; }
  get sinceLastSend() { return this.lastSentAt ? this.now() - this.lastSentAt : null; }
}

/** A getUserMedia failure → a sentence the user can act on. */
export function cameraError(e: unknown): string {
  const n = (e as Error)?.name;
  return n === 'NotAllowedError' || n === 'SecurityError' ? 'Camera permission was denied. Live Vision stays off — allow the camera for this site in the browser (or system) settings to use it.'
    : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'No camera was found on this device.'
    : n === 'NotReadableError' || n === 'AbortError' ? 'The camera is in use by another program or could not be started.'
    : `The camera could not be started (${(e as Error)?.message || n}).`;
}

/** 16×12 greyscale thumbnail of the frame (192 bytes). */
function signature(g: CanvasRenderingContext2D, w: number, h: number): Uint8Array {
  const out = new Uint8Array(16 * 12);
  try {
    const d = g.getImageData(0, 0, w, h).data; const sx = w / 16, sy = h / 12;
    for (let y = 0; y < 12; y++) for (let x = 0; x < 16; x++) { const i = (Math.floor(y * sy + sy / 2) * w + Math.floor(x * sx + sx / 2)) * 4; out[y * 16 + x] = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) | 0; }
  } catch { /* unreadable canvas: every frame counts as changed */ out.fill(0); out[0] = Math.random() * 255; }
  return out;
}
/** two signatures differ by less than ~3% average brightness → the same view */
export function similar(a: Uint8Array, b: Uint8Array, tol = 7): boolean { if (a.length !== b.length) return false; let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length < tol; }
