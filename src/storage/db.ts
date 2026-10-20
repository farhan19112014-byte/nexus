/** Minimal promise wrapper over IndexedDB (local-first persistence). Falls back to memory. */
export type StoreName = 'skills' | 'feedback' | 'memory' | 'summaries' | 'kv' | 'log' | 'chats' | 'reminders';

/** Thrown by stores when persistence fails, so callers can report instead of claiming success. */
export class StorageError extends Error {}

const DB_NAME = 'nexus-companion-2d';
const DB_VERSION = 2; // v2 adds 'chats' and 'reminders' (existing data is kept)

export interface KV { get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined>; put<T>(store: StoreName, value: T, key?: IDBValidKey): Promise<void>; del(store: StoreName, key: IDBValidKey): Promise<void>; all<T>(store: StoreName): Promise<T[]>; clear(store: StoreName): Promise<void>; readonly persistent: boolean }

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

class IDBStore implements KV {
  readonly persistent = true;
  private dbp: Promise<IDBDatabase>;
  constructor(factory: IDBFactory, name: string) {
    this.dbp = new Promise((res, rej) => {
      const open = factory.open(name, DB_VERSION);
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
      };
      open.onsuccess = () => { const db = open.result; db.onversionchange = () => db.close(); res(db); };
      open.onblocked = () => console.warn('[nexus] storage upgrade is waiting for another NEXUS tab to close.');
      open.onerror = () => rej(open.error);
    });
  }
  private async tx(store: StoreName, mode: IDBTransactionMode) { return (await this.dbp).transaction(store, mode).objectStore(store); }
  async get<T>(store: StoreName, key: IDBValidKey) { return req((await this.tx(store, 'readonly')).get(key)) as Promise<T | undefined>; }
  async put<T>(store: StoreName, value: T, key?: IDBValidKey) { await req((await this.tx(store, 'readwrite')).put(value, key)); }
  async del(store: StoreName, key: IDBValidKey) { await req((await this.tx(store, 'readwrite')).delete(key)); }
  async all<T>(store: StoreName) { return req((await this.tx(store, 'readonly')).getAll()) as Promise<T[]>; }
  async clear(store: StoreName) { await req((await this.tx(store, 'readwrite')).clear()); }
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
