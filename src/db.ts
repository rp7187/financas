import type { Rec } from "./model";

/**
 * Armazenamento local (IndexedDB). Um store único com todos os registros (contas, categorias,
 * lançamentos, recorrentes, parcelamentos) — formato pensado para a sincronização da fase 2.
 */
// ATENÇÃO: os dados dos aparelhos dependem destes nomes. Não renomear; mudanças de estrutura só com
// nova versão + migração em onupgradeneeded, sem apagar registros (ver CLAUDE.md).
const DB_NAME = "financas";
const STORE = "records";
const META = "meta";

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req ? req.result : (undefined as T));
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const getAll = () => run<Rec[]>(STORE, "readonly", (s) => s.getAll() as IDBRequest<Rec[]>);
export const putMany = (rs: Rec[]) => run(STORE, "readwrite", (s) => { for (const r of rs) s.put(r); });
export const clearAll = () => run(STORE, "readwrite", (s) => { s.clear(); });
export const getMeta = <T>(key: string) => run<T | undefined>(META, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
export const setMeta = (key: string, value: unknown) => run(META, "readwrite", (s) => { s.put(value, key); });

export async function requestPersist(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}
