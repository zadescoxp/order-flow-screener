// Recording storage backends: IndexedDB in the browser, a Map in tests.

import type { RecordingChunk, RecordingMeta, RecordingStorage } from "./types";

const DB_NAME = "oft-recordings";
const DB_VERSION = 1;
const META = "recordings";
const CHUNKS = "chunks";

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export class IndexedDBRecordingStorage implements RecordingStorage {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "id" });
          if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS, { keyPath: ["recordingId", "seq"] });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          this.db = null;
          reject(request.error);
        };
      });
    }
    return this.db;
  }

  async putMeta(meta: RecordingMeta): Promise<void> {
    const tx = (await this.open()).transaction(META, "readwrite");
    tx.objectStore(META).put(meta);
    await done(tx);
  }

  async putChunk(chunk: RecordingChunk): Promise<void> {
    const tx = (await this.open()).transaction(CHUNKS, "readwrite");
    tx.objectStore(CHUNKS).put(chunk);
    await done(tx);
  }

  async listMeta(): Promise<RecordingMeta[]> {
    const tx = (await this.open()).transaction(META, "readonly");
    const all = await promisify(tx.objectStore(META).getAll() as IDBRequest<RecordingMeta[]>);
    return all.sort((a, b) => b.startedAt - a.startedAt);
  }

  async getMeta(id: string): Promise<RecordingMeta | undefined> {
    const tx = (await this.open()).transaction(META, "readonly");
    return promisify(tx.objectStore(META).get(id) as IDBRequest<RecordingMeta | undefined>);
  }

  async getChunk(recordingId: string, seq: number): Promise<RecordingChunk | undefined> {
    const tx = (await this.open()).transaction(CHUNKS, "readonly");
    return promisify(tx.objectStore(CHUNKS).get([recordingId, seq]) as IDBRequest<RecordingChunk | undefined>);
  }

  async delete(id: string): Promise<void> {
    const tx = (await this.open()).transaction([META, CHUNKS], "readwrite");
    tx.objectStore(META).delete(id);
    tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
    await done(tx);
  }
}

export class MemoryRecordingStorage implements RecordingStorage {
  readonly metas = new Map<string, RecordingMeta>();
  readonly chunks = new Map<string, RecordingChunk>();

  async putMeta(meta: RecordingMeta) { this.metas.set(meta.id, structuredClone(meta)); }
  async putChunk(chunk: RecordingChunk) { this.chunks.set(`${chunk.recordingId}:${chunk.seq}`, structuredClone(chunk)); }
  async listMeta() { return [...this.metas.values()].sort((a, b) => b.startedAt - a.startedAt); }
  async getMeta(id: string) { return this.metas.get(id); }
  async getChunk(recordingId: string, seq: number) { return this.chunks.get(`${recordingId}:${seq}`); }
  async delete(id: string) {
    this.metas.delete(id);
    for (const key of [...this.chunks.keys()]) if (key.startsWith(`${id}:`)) this.chunks.delete(key);
  }
}

let shared: RecordingStorage | null = null;

/** The browser's recording store (IndexedDB), or null where it isn't available. */
export function recordingStorage(): RecordingStorage | null {
  if (typeof indexedDB === "undefined") return null;
  if (!shared) shared = new IndexedDBRecordingStorage();
  return shared;
}
