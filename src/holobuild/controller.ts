/**
 * HOLOBUILD controller: the state of the workspace and every action on it (build, edit, select, explode, undo, save,
 * import, export). React components only render its snapshot — so the behaviour is unit-tested without WebGL.
 *
 * Honesty rules enforced here:
 *  - a model is either a NEXUS template, an AI-designed procedural model (validated), or an imported file — and says so;
 *  - when no template fits and no AI model is connected, NEXUS says it cannot build that, instead of showing something else;
 *  - edits change only what was named (shared/holoEdit + applyOps); ambiguous edits ask first.
 */
import { applyOps, coerceModel, describeForAI, HOLO_LIMITS, HoloModelSchema, type HoloModel, type HoloOp } from '../../shared/holo';
import { parseEdit } from '../../shared/holoEdit';
import { TEMPLATES, buildSubject, buildTemplate, matchTemplate, newModelId } from './templates';
import type { HoloStore } from './store';
import type { ImportedGeometry } from './scene';

export interface HoloView { projection: 'perspective' | 'orthographic'; wireframe: boolean; grid: boolean; axes: boolean; labels: boolean; measure: boolean; exploded: boolean; explodeDistance: number }
export type HoloStatus = { kind: 'idle' | 'working' | 'ok' | 'error' | 'info'; text: string };
export interface HoloSnap {
  model: HoloModel | null; selected: string | null; view: HoloView; status: HoloStatus;
  saved: HoloModel[]; session: HoloModel[]; dirty: boolean; savedId: string | null; canUndo: boolean; canRedo: boolean;
  clarify: { message: string; candidates: string[] } | null; busy: boolean; skippedRecords: number;
}
export type HoloOutcome = { kind: 'build' | 'edit' | 'ui' | 'clarify' | 'question' | 'refused' | 'error' | 'none'; message: string };
/** what HOLOBUILD tells the learning engine (real events only) */
export type HoloExperience = { type: 'build-unmatched' | 'build-failed' | 'edit-unparsed' | 'edit-failed' | 'edit-corrected' | 'export-failed'; text: string; detail?: string };

export interface HoloDeps {
  store: HoloStore;
  /** POST a structured AI task to the NEXUS server (ApiClient.task) */
  task: (path: string, body: unknown, signal?: AbortSignal) => Promise<unknown>;
  /** null = unknown yet; false = demo / web demo / offline */
  aiAvailable: () => boolean | null;
  activity?: (kind: 'building' | 'editing', label: string) => (outcome: 'done' | 'failed' | 'cancelled') => void;
  announce?: (text: string) => void;
  /** a question about the open model → the normal NEXUS conversation, with the model as context */
  ask?: (text: string, workspace: string) => void;
  experience?: (e: HoloExperience) => void;
}

const DEFAULT_VIEW: HoloView = { projection: 'perspective', wireframe: false, grid: true, axes: false, labels: false, measure: false, exploded: false, explodeDistance: 0.6 };
const BUILD_RE = /^(?:hey\s+)?(?:nexus[,:]?\s*)?(?:please\s+|can you\s+|could you\s+)?(?:build|create|generate|design|construct|render|draw|model)\b|^(?:please\s+)?(?:make|show)\s+(?:me\s+|us\s+)?(?:a|an|some|the)\s+(?:model|3d)\b|^(?:please\s+)?make\s+(?:me\s+)?(?:a|an)\s/i;
const EDIT_VERB = /^(?:please\s+)?(make|change|set|turn|move|shift|rotate|spin|scale|resize|stretch|shrink|enlarge|hide|show|remove|delete|add|duplicate|copy|paint|colou?r|swap|replace|rename|isolate|lower|raise|widen|lengthen|shorten|flip)\b/i;
export const isBuildRequest = (t: string) => BUILD_RE.test(t.trim());

export class HoloController {
  private snap: HoloSnap = { model: null, selected: null, view: { ...DEFAULT_VIEW }, status: { kind: 'idle', text: 'Describe something to build, or pick an example.' }, saved: [], session: [], dirty: false, savedId: null, canUndo: false, canRedo: false, clarify: null, busy: false, skippedRecords: 0 };
  private listeners = new Set<() => void>();
  private undoStack: HoloModel[] = []; private redoStack: HoloModel[] = [];
  private abort: AbortController | null = null;
  /** geometry of imported files, per model id (kept in memory; the file itself is stored on save) */
  readonly imported = new Map<string, ImportedGeometry>();
  private pendingFiles = new Map<string, ArrayBuffer>();
  /** last edit command, to notice a correction ("no, the other wheel") */
  private lastEdit: { text: string; at: number } | null = null;

  constructor(private d: HoloDeps) {}
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  getSnapshot = () => this.snap;
  private set(p: Partial<HoloSnap>) { this.snap = { ...this.snap, ...p, canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 }; this.listeners.forEach((f) => f()); }
  private status(kind: HoloStatus['kind'], text: string) { this.set({ status: { kind, text } }); }

  async init(): Promise<void> {
    try { const { models, skipped } = await this.d.store.list(); this.set({ saved: models, skippedRecords: skipped }); if (skipped) this.status('info', `${skipped} saved model record(s) could not be read and were skipped.`); }
    catch (e) { this.status('error', (e as Error).message); }
  }

  /* ---------------- routing ---------------- */
  /** The command bar: build, edit, view action, or a question about the open model. */
  async command(raw: string): Promise<HoloOutcome> {
    const text = raw.trim().slice(0, 400); if (!text) return { kind: 'none', message: '' };
    const m = this.snap.model;
    const question = /\?$/.test(text) || /^(what|how|why|who|when|where|which|is|are|can|could|does|do|explain|tell me|describe)\b/i.test(text);
    if (isBuildRequest(text) || (!m && !question)) {
      const subject = buildSubject(text) ?? (!m ? text.replace(/^(a|an|the)\s+/i, '') : null);
      if (subject) return this.build(subject, text);
    }
    if (!m) { this.d.ask?.(text, ''); return { kind: 'question', message: 'Asked NEXUS.' }; }
    {
      const r = parseEdit(text, m, this.snap.selected);
      if (r?.kind === 'ops') return this.apply(r.ops, text);
      if (r?.kind === 'ui') return this.ui(r.action);
      if (r?.kind === 'clarify') { this.set({ clarify: { message: r.message, candidates: r.candidates } }); this.status('info', r.message); this.d.experience?.({ type: 'edit-unparsed', text, detail: r.message }); return { kind: 'clarify', message: r.message }; }
      if (this.snap.clarify) this.set({ clarify: null });
      if (EDIT_VERB.test(text)) return this.aiEdit(text);
      this.d.ask?.(text, describeForAI(m, this.snap.selected));
      return { kind: 'question', message: 'Asked NEXUS about the model.' };
    }
  }

  /* ---------------- building ---------------- */
  async build(subject: string, prompt = subject): Promise<HoloOutcome> {
    const t = matchTemplate(subject);
    if (t) {
      const model = buildTemplate(t, prompt);
      this.open(model, { fresh: true });
      const msg = `Built “${model.name}” from my ${t.name.toLowerCase()} template — ${model.parts.length} parts.`;
      this.status('ok', msg); this.d.announce?.(`${msg} ${model.caveat ? `Note: ${model.caveat}` : ''}`.trim());
      const end = this.d.activity?.('building', model.name); end?.('done');
      return { kind: 'build', message: msg };
    }
    const ai = this.d.aiAvailable();
    if (ai === false) {
      const msg = `I don't have a built-in template for “${subject}”, and no AI model is connected, so I can't design it. Templates I can build offline: ${TEMPLATES.map((x) => x.name.toLowerCase()).join(', ')}.`;
      this.status('info', msg); this.d.experience?.({ type: 'build-unmatched', text: subject }); return { kind: 'refused', message: msg };
    }
    this.abort?.abort(); const ctl = new AbortController(); this.abort = ctl;
    const end = this.d.activity?.('building', subject);
    this.set({ busy: true }); this.status('working', `Designing “${subject}” with the AI model (procedural parts, not a mesh)…`);
    try {
      const res = await this.d.task('/api/holo/design', { prompt: subject.slice(0, 400) }, ctl.signal) as { refuse?: string; model?: unknown; dropped?: string[] };
      if (ctl.signal.aborted) { end?.('cancelled'); return { kind: 'none', message: 'Cancelled.' }; }
      if (res?.refuse) { end?.('failed'); this.status('info', `I won't build that: ${res.refuse}`); return { kind: 'refused', message: res.refuse }; }
      // validated again here: the browser never trusts the server's copy of an AI answer either
      const now = Date.now(); const raw = (res?.model ?? {}) as Record<string, unknown>;
      const { model, dropped } = coerceModel(raw, { id: newModelId(), origin: 'ai-procedural', source: String(raw.source ?? 'AI model').slice(0, 120), prompt: subject, createdAt: now, updatedAt: now });
      if (!model) throw new Error('The AI design had no usable parts.');
      if (raw.front === '+x' || raw.front === '+z') model.front = raw.front;
      if (!model.caveat) model.caveat = 'AI-designed approximation from basic shapes — not to scale and not an engineering design.';
      this.open(model, { fresh: true }); end?.('done');
      const msg = `Designed “${model.name}” with the AI model: ${model.parts.length} parts${dropped.length ? ` (${dropped.length} invalid part(s) skipped)` : ''}. It is an approximation built from basic shapes.`;
      this.status('ok', msg); this.d.announce?.(msg);
      return { kind: 'build', message: msg };
    } catch (e) {
      end?.(ctl.signal.aborted ? 'cancelled' : 'failed');
      const msg = `Couldn't design “${subject}”: ${(e as Error).message}`;
      this.status('error', msg); this.d.experience?.({ type: 'build-failed', text: subject, detail: (e as Error).message });
      return { kind: 'error', message: msg };
    } finally { if (this.abort === ctl) this.abort = null; this.set({ busy: false }); }
  }
  cancel() { this.abort?.abort(); this.abort = null; this.set({ busy: false }); this.status('info', 'Cancelled.'); }

  /** Opens a model in the workspace (fresh = newly generated: goes to this session's unsaved list). */
  open(model: HoloModel, o: { fresh?: boolean; saved?: boolean } = {}) {
    this.undoStack = []; this.redoStack = []; this.lastEdit = null;
    const session = o.fresh ? [model, ...this.snap.session.filter((x) => x.id !== model.id)].slice(0, 12) : this.snap.session;
    this.set({ model, selected: null, clarify: null, session, dirty: !!o.fresh && !o.saved, savedId: o.saved ? model.id : null, view: { ...this.snap.view, exploded: false } });
  }
  close() { this.undoStack = []; this.redoStack = []; this.set({ model: null, selected: null, clarify: null, dirty: false, savedId: null }); this.status('idle', 'Describe something to build, or pick an example.'); }

  /* ---------------- editing ---------------- */
  apply(ops: HoloOp[], label: string): HoloOutcome {
    const m = this.snap.model; if (!m) return { kind: 'none', message: 'No model is open.' };
    const r = applyOps(m, ops);
    if (!r.changed) { const msg = r.log.join(' ') || 'Nothing changed.'; this.status('info', msg); return { kind: 'edit', message: msg }; }
    // a quick follow-up edit after an undo, or one starting with "no"/"not", is a correction of the previous edit
    if (this.lastEdit && Date.now() - this.lastEdit.at < 60000 && /^(no|not|actually|i meant|wrong)\b/i.test(label)) this.d.experience?.({ type: 'edit-corrected', text: label, detail: `previous: ${this.lastEdit.text}` });
    this.lastEdit = { text: label, at: Date.now() };
    this.undoStack.push(m); if (this.undoStack.length > 60) this.undoStack.shift(); this.redoStack = [];
    const model = { ...r.model, edits: [...r.model.edits, label.slice(0, 200)].slice(-200) };
    const sel = this.snap.selected && model.parts.some((p) => p.id === this.snap.selected) ? this.snap.selected : null;
    this.set({ model, selected: sel, clarify: null, dirty: true });
    const msg = r.log.join(' '); this.status('ok', msg);
    return { kind: 'edit', message: msg };
  }
  private async aiEdit(text: string): Promise<HoloOutcome> {
    const m = this.snap.model!;
    if (this.d.aiAvailable() === false) {
      const msg = 'I didn’t understand that edit, and no AI model is connected to interpret it. Try e.g. “make the roof taller”, “move the engine forward”, “change the material to steel”, “remove the rear wheel”.';
      this.status('info', msg); this.d.experience?.({ type: 'edit-unparsed', text }); return { kind: 'refused', message: msg };
    }
    this.abort?.abort(); const ctl = new AbortController(); this.abort = ctl;
    const end = this.d.activity?.('editing', m.name); this.set({ busy: true }); this.status('working', 'Asking the AI model how to apply that edit…');
    const targets = [...new Set([...m.parts.map((p) => p.id), ...m.parts.map((p) => p.group).filter(Boolean)])].slice(0, HOLO_LIMITS.parts + 40);
    try {
      const res = await this.d.task('/api/holo/edit', { command: text.slice(0, 300), model: describeForAI(m, this.snap.selected), targets, selected: this.snap.selected }, ctl.signal) as { ops?: unknown[]; reply?: string; clarify?: string };
      if (res?.clarify) { end?.('done'); this.set({ clarify: { message: res.clarify, candidates: [] } }); this.status('info', res.clarify); return { kind: 'clarify', message: res.clarify }; }
      // re-validated on this side too (applyOps also ignores unknown targets)
      const { HoloOpSchema } = await import('../../shared/holo');
      const ops = (res?.ops ?? []).map((o) => HoloOpSchema.safeParse(o)).filter((x) => x.success).map((x) => x.data!) as HoloOp[];
      if (!ops.length) throw new Error('the AI model returned no valid operations');
      const out = this.apply(ops, text); end?.('done'); return out;
    } catch (e) {
      end?.(ctl.signal.aborted ? 'cancelled' : 'failed');
      const msg = `Couldn't apply that edit: ${(e as Error).message}`; this.status('error', msg);
      this.d.experience?.({ type: 'edit-failed', text, detail: (e as Error).message });
      return { kind: 'error', message: msg };
    } finally { if (this.abort === ctl) this.abort = null; this.set({ busy: false }); }
  }
  undo() { const prev = this.undoStack.pop(); if (!prev || !this.snap.model) return; this.redoStack.push(this.snap.model); this.set({ model: prev, dirty: true }); this.status('info', 'Undid the last change.'); }
  redo() { const next = this.redoStack.pop(); if (!next || !this.snap.model) return; this.undoStack.push(this.snap.model); this.set({ model: next, dirty: true }); this.status('info', 'Redid the change.'); }
  ui(action: 'explode' | 'assemble' | 'reset-view' | 'undo'): HoloOutcome {
    if (action === 'undo') { this.undo(); return { kind: 'ui', message: 'Undone.' }; }
    if (action === 'explode' || action === 'assemble') { this.setView({ exploded: action === 'explode' }); return { kind: 'ui', message: action === 'explode' ? 'Exploded view.' : 'Reassembled.' }; }
    this.resetRequested++; this.set({}); return { kind: 'ui', message: 'View reset.' };
  }
  /** incremented when the camera should be reset (the viewport watches it) */
  resetRequested = 0;
  select(id: string | null) { if (id && !this.snap.model?.parts.some((p) => p.id === id)) return; this.set({ selected: id, clarify: null }); }
  setView(p: Partial<HoloView>) { this.set({ view: { ...this.snap.view, ...p, explodeDistance: Math.min(1, Math.max(0, p.explodeDistance ?? this.snap.view.explodeDistance)) } }); }
  /** Assembly steps: shows only the parts added up to step i (one undoable change). */
  showStep(i: number) {
    const m = this.snap.model; if (!m || !m.steps[i]) return;
    const keep = new Set(m.steps.slice(0, i + 1).flatMap((x) => x.parts)); if (!keep.size) return;
    this.undoStack.push(m); this.redoStack = [];
    this.set({ model: { ...m, parts: m.parts.map((p) => ({ ...p, visible: keep.has(p.id) })), edits: [...m.edits, `show up to step ${i + 1}: ${m.steps[i].title}`].slice(-200) }, dirty: true });
    this.status('ok', `Step ${i + 1} of ${m.steps.length}: ${m.steps[i].title}. ${m.steps[i].text}`);
  }
  /** part visibility toggles from the parts list */
  togglePart(id: string) { const p = this.snap.model?.parts.find((x) => x.id === id); if (p) this.apply([{ op: p.visible ? 'hide' : 'show', target: id }], `${p.visible ? 'hide' : 'show'} ${p.name}`); }

  /* ---------------- library ---------------- */
  async save(o: { name?: string; collection?: string } = {}): Promise<boolean> {
    const m = this.snap.model; if (!m) return false;
    try {
      const saved = await this.d.store.save({ ...m, ...(o.name ? { name: o.name.slice(0, HOLO_LIMITS.nameChars) } : {}), ...(o.collection !== undefined ? { collection: o.collection.slice(0, 40) } : {}) });
      const file = this.pendingFiles.get(m.id); if (file) { await this.d.store.saveFile(m.id, file); this.pendingFiles.delete(m.id); }
      // read back before reporting success
      const back = await this.d.store.get(saved.id); if (!back) throw new Error('the saved model could not be read back');
      const { models } = await this.d.store.list();
      this.set({ model: back, saved: models, session: this.snap.session.filter((x) => x.id !== back.id), dirty: false, savedId: back.id });
      this.status('ok', `Saved “${back.name}”${this.d.store.persistent ? '' : ' (this browser has no persistent storage — it will be lost when the tab closes)'}.`);
      return true;
    } catch (e) { this.status('error', (e as Error).message); return false; }
  }
  async rename(name: string): Promise<boolean> {
    const n = name.trim().slice(0, HOLO_LIMITS.nameChars); const m = this.snap.model; if (!n || !m) return false;
    this.apply([{ op: 'rename', name: n }], `rename to ${n}`);
    return this.snap.savedId === m.id || this.snap.saved.some((x) => x.id === m.id) ? this.save() : true;
  }
  async reopen(id: string): Promise<boolean> {
    const m = await this.d.store.get(id); if (!m) { this.status('error', 'That model could not be read.'); return false; }
    if (m.origin === 'imported' && !this.imported.has(id)) {
      const file = await this.d.store.getFile(id);
      if (file) { try { await this.loadImportedGeometry(id, file); } catch { this.status('info', 'The imported file could not be decoded; showing placeholder boxes.'); } }
    }
    this.open(m, { saved: true }); this.status('ok', `Opened “${m.name}”.`); return true;
  }
  openSession(id: string) { const m = this.snap.session.find((x) => x.id === id); if (m) { this.open(m); this.set({ dirty: true }); } }
  /** deletes a saved model (the UI asks for confirmation first) */
  async remove(id: string): Promise<boolean> {
    try {
      await this.d.store.remove(id); this.imported.delete(id);
      const { models } = await this.d.store.list();
      this.set({ saved: models, ...(this.snap.model?.id === id ? { savedId: null, dirty: true } : {}) });
      this.status('ok', 'Deleted the saved model.'); return true;
    } catch (e) { this.status('error', (e as Error).message); return false; }
  }

  /* ---------------- import / export ---------------- */
  private async loadImportedGeometry(id: string, buf: ArrayBuffer) {
    const THREE = await import('three'); const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js'); const { partsFromScene } = await import('./scene');
    const gltf = await new GLTFLoader().parseAsync(buf, '');
    const r = partsFromScene(THREE, gltf.scene, HOLO_LIMITS.importMeshes); this.imported.set(id, r.geometry); return r;
  }
  async importFile(buf: ArrayBuffer, fileName: string): Promise<HoloOutcome> {
    const { inspectGltf } = await import('./io');
    const check = inspectGltf(buf, fileName);
    if (!check.ok) { this.status('error', `Import refused: ${check.error}`); return { kind: 'error', message: check.error ?? 'invalid file' }; }
    try {
      const id = newModelId(); const r = await this.loadImportedGeometry(id, buf);
      if (!r.parts.length) throw new Error('no meshes could be read');
      const now = Date.now(); const name = fileName.replace(/\.(glb|gltf)$/i, '').slice(0, HOLO_LIMITS.nameChars) || 'Imported model';
      const model = HoloModelSchema.parse({ id, name, prompt: '', origin: 'imported', source: fileName.slice(0, 120), category: 'imported', description: `Imported from ${fileName}.`, caveat: 'Imported file: part names come from the file; NEXUS has not checked its accuracy.', parts: r.parts, createdAt: now, updatedAt: now });
      this.pendingFiles.set(id, buf); this.open(model, { fresh: true });
      const msg = `Imported ${fileName}: ${r.parts.length} mesh part(s)${r.truncated ? ` (only the first ${HOLO_LIMITS.importMeshes} were kept)` : ''}.`;
      this.status('ok', msg); return { kind: 'build', message: msg };
    } catch (e) { const msg = `Import failed: ${(e as Error).message}`; this.status('error', msg); return { kind: 'error', message: msg }; }
  }
  /** Builds a clean copy of the model (assembled, no highlight) and exports it; the file is re-validated before download. */
  async exportFile(binary: boolean): Promise<{ data: Blob; name: string } | null> {
    const m = this.snap.model; if (!m) return null;
    try {
      const THREE = await import('three'); const { buildModel } = await import('./scene'); const { exportObject, safeFileName } = await import('./io');
      const built = buildModel(THREE, m, { wireframe: false, imported: this.imported.get(m.id) });
      try {
        const { data, check } = await exportObject(built.root, binary);
        if (!check.ok) throw new Error(`the exported file failed validation (${check.error})`);
        const visible = m.parts.filter((p) => p.visible).length;
        if (check.meshes !== visible) throw new Error(`the exported file has ${check.meshes} meshes, expected ${visible}`);
        this.status('ok', `Exported ${visible} part(s) as ${binary ? 'GLB' : 'GLTF'} — file checked.`);
        return { data: new Blob([data], { type: binary ? 'model/gltf-binary' : 'model/gltf+json' }), name: `${safeFileName(m.name)}.${binary ? 'glb' : 'gltf'}` };
      } finally { built.dispose(); }
    } catch (e) { this.status('error', `Export failed: ${(e as Error).message}`); this.d.experience?.({ type: 'export-failed', text: m.name, detail: (e as Error).message }); return null; }
  }
}
