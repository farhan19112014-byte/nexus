/** Minimal promise wrapper over IndexedDB (local-first persistence). Falls back to memory. */
export type StoreName = 'skills' | 'feedback' | 'memory' | 'summaries' | 'kv' | 'log' | 'chats' | 'reminders'
  // v3: HOLOBUILD models + imported files; learning engine (knowledge, experiences, research reports, workflow skills, audit log)
  | 'holo' | 'holoFiles' | 'knowledge' | 'experiences' | 'research' | 'wskills' | 'audit';

/** Thrown by stores when persistence fails, so callers can report instead of claiming success. */
export class StorageError extends Error {}

const DB_NAME = 'nexus-companion-2d';
const DB_VERSION = 3; // v2 adds 'chats' and 'reminders'; v3 adds HOLOBUILD + learning stores (existing data is kept)

export interface KV { get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined>; put<T>(store: StoreName, value: T, key?: IDBValidKey): Promise<void>; del(store: StoreName, key: IDBValidKey): Promise<void>; all<T>(store: StoreName): Promise<T[]>; clear(store: StoreName): Promise<void>; readonly persistent: boolean }

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

class IDBStore implements KV {
  /** false once IndexedDB turned out to be unusable here (private mode, blocked storage): then nothing persists */
  get persistent() { return !this.fallback; }
  private dbp: Promise<IDBDatabase>;
  private fallback: MemoryKV | null = null;
  constructor(private factory: IDBFactory, private name: string) { this.dbp = this.open(); }
  private open(): Promise<IDBDatabase> {
    const p = new Promise<IDBDatabase>((res, rej) => {
      const open = this.factory.open(this.name, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('skills')) db.createObjectStore('skills', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('feedback')) db.createObjectStore('feedback', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('memory')) db.createObjectStore('memory', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('summaries')) db.createObjectStore('summaries', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('log')) db.createObjectStore('log', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('chats')) db.createObjectStore('chats', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('reminders')) db.createObjectStore('reminders', { keyPath: 'id' });
        for (const s of ['holo', 'knowledge', 'experiences', 'research', 'wskills'] as const) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
        if (!db.objectStoreNames.contains('holoFiles')) db.createObjectStore('holoFiles');
        if (!db.objectStoreNames.contains('audit')) db.createObjectStore('audit', { keyPath: 'id', autoIncrement: true });
      };
      // another tab upgrading the database closes this connection: the next operation opens it again
      open.onsuccess = () => { const db = open.result; db.onversionchange = () => { db.close(); this.dbp = this.open(); }; db.onclose = () => { this.dbp = this.open(); }; res(db); };
      open.onblocked = () => console.warn('[nexus] storage upgrade is waiting for another NEXUS tab to close.');
      open.onerror = () => rej(open.error);
    });
    // IndexedDB exists but cannot be opened (private mode, blocked site data): keep working in memory and say so
    p.catch(() => { if (!this.fallback) { this.fallback = new MemoryKV(); console.warn('[nexus] IndexedDB could not be opened — using in-memory storage (nothing will persist).'); } });
    return p;
  }
  private async db(): Promise<IDBDatabase | null> { try { return await this.dbp; } catch { return null; } }
  /** a write counts as saved only when its transaction has COMMITTED (a quota error aborts the transaction after the request itself succeeded) */
  private async write(store: StoreName, f: (s: IDBObjectStore) => IDBRequest): Promise<void> {
    const db = (await this.db())!;
    const t = db.transaction(store, 'readwrite');
    const done = new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onabort = () => rej(t.error ?? new Error('storage transaction aborted')); t.onerror = () => rej(t.error ?? new Error('storage write failed')); });
    f(t.objectStore(store)); await done;
  }
  async get<T>(store: StoreName, key: IDBValidKey) { const db = await this.db(); if (!db) return this.fallback!.get<T>(store, key); return req(db.transaction(store, 'readonly').objectStore(store).get(key)) as Promise<T | undefined>; }
  async put<T>(store: StoreName, value: T, key?: IDBValidKey) { const db = await this.db(); if (!db) return this.fallback!.put(store, value, key); await this.write(store, (s) => s.put(value, key)); }
  async del(store: StoreName, key: IDBValidKey) { const db = await this.db(); if (!db) return this.fallback!.del(store, key); await this.write(store, (s) => s.delete(key)); }
  async all<T>(store: StoreName) { const db = await this.db(); if (!db) return this.fallback!.all<T>(store); return req(db.transaction(store, 'readonly').objectStore(store).getAll()) as Promise<T[]>; }
  async clear(store: StoreName) { const db = await this.db(); if (!db) return this.fallback!.clear(store); await this.write(store, (s) => s.clear()); }
}

export class MemoryKV implements KV {
  readonly persistent = false;
  /** test hook: simulate storage failures (quota, private mode, corrupted DB) */
  failWrites = false;
  private maps = new Map<StoreName, Map<IDBValidKey, unknown>>();
  private seq = 1;
  private m(s: StoreName) { let x = this.maps.get(s); if (!x) this.maps.set(s, (x = new Map())); return x; }
  async get<T>(s: StoreName, k: IDBValidKey) { return structuredClone(this.m(s).get(k)) as T | undefined; }
  async put<T>(s: StoreName, v: T, k?: IDBValidKey) {
    if (this.failWrites) throw new Error('simulated storage failure');
    let key = k ?? (v as { id?: IDBValidKey }).id;
    if (key === undefined) { key = this.seq++; (v as { id?: IDBValidKey }).id = key; }
    this.m(s).set(key, structuredClone(v));
  }
  async del(s: StoreName, k: IDBValidKey) { if (this.failWrites) throw new Error('simulated storage failure'); this.m(s).delete(k); }
  async all<T>(s: StoreName) { return [...this.m(s).values()].map((v) => structuredClone(v)) as T[]; }
  async clear(s: StoreName) { this.m(s).clear(); }
}

export function openStore(name = DB_NAME): KV {
  try {
    const f = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (f) return new IDBStore(f, name);
  } catch { /* private mode etc. */ }
  console.warn('[nexus] IndexedDB unavailable — using in-memory storage (nothing will persist).');
  return new MemoryKV();
}
