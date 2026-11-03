/**
 * HOLOBUILD library: saved models in IndexedDB ('holo'), imported source files in 'holoFiles' (keyed by model id).
 * Everything read back is validated again — a corrupted or hand-edited record is skipped and reported, never rendered.
 */
import { HoloModelSchema, type HoloModel } from '../../shared/holo';
import { StorageError, type KV } from '../storage/db';

export class HoloStore {
  constructor(private kv: KV) {}
  get persistent() { return this.kv.persistent; }

  /** saved models, most recently changed first; `skipped` counts unreadable records */
  async list(): Promise<{ models: HoloModel[]; skipped: number }> {
    let raw: unknown[] = [];
    try { raw = await this.kv.all<unknown>('holo'); } catch (e) { throw new StorageError(`Could not read the model library: ${(e as Error).message}`); }
    const models: HoloModel[] = []; let skipped = 0;
    for (const r of raw) { const ok = HoloModelSchema.safeParse(r); if (ok.success) models.push(ok.data); else skipped++; }
    return { models: models.sort((a, b) => b.updatedAt - a.updatedAt), skipped };
  }
  async get(id: string): Promise<HoloModel | null> {
    const ok = HoloModelSchema.safeParse(await this.kv.get('holo', id)); return ok.success ? ok.data : null;
  }
  async save(m: HoloModel): Promise<HoloModel> {
    const v = HoloModelSchema.parse({ ...m, updatedAt: Date.now(), createdAt: m.createdAt || Date.now() });
    try { await this.kv.put('holo', v); } catch (e) { throw new StorageError(`Could not save “${m.name}”: ${(e as Error).message}`); }
    return v;
  }
  async remove(id: string): Promise<void> {
    try { await this.kv.del('holo', id); await this.kv.del('holoFiles', id); } catch (e) { throw new StorageError(`Could not delete the model: ${(e as Error).message}`); }
  }
  async saveFile(id: string, data: ArrayBuffer): Promise<void> {
    try { await this.kv.put('holoFiles', data, id); } catch (e) { throw new StorageError(`Could not store the imported file: ${(e as Error).message}`); }
  }
  async getFile(id: string): Promise<ArrayBuffer | null> { return (await this.kv.get<ArrayBuffer>('holoFiles', id)) ?? null; }
  async collections(): Promise<string[]> {
    const { models } = await this.list(); return [...new Set(models.map((m) => m.collection).filter(Boolean))].sort();
  }
}
