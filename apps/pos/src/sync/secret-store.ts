import { API_KEY_RE } from '@dayo/contracts'

/**
 * spec 04 §7 ข้อ 1: the device API key lives in IndexedDB, NOT in SQLite — the SQLite file is what the backup screen
 * exports (exportDbFile), so a key there would leak into every backup. Never synced, never logged, never shown again.
 */
export type SecretStore = { getApiKey(): Promise<string | null>; setApiKey(key: string): Promise<void>; clearApiKey(): Promise<void> }

const STORE = 'secrets'
const API_KEY = 'dayo.api_key'

export function maskApiKey(key: string): string {
  return `dayo_…${key.slice(-4)}`
}

function check(key: string): void {
  if (!API_KEY_RE.test(key)) throw new Error('BAD_API_KEY: not a dayo_<64 hex> key') // never echo the value
}

export function createMemorySecretStore(initial: string | null = null): SecretStore {
  let value = initial
  return {
    getApiKey: async () => value,
    setApiKey: async (key) => { check(key); value = key },
    clearApiKey: async () => { value = null },
  }
}

export function createIdbSecretStore(dbName = 'dayo-pos-secrets'): SecretStore {
  const open = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open()
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const req = fn(tx.objectStore(STORE))
        tx.oncomplete = () => resolve(req.result)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
  }
  return {
    getApiKey: async () => ((await run('readonly', (s) => s.get(API_KEY))) as string | undefined) ?? null,
    setApiKey: async (key) => { check(key); await run('readwrite', (s) => s.put(key, API_KEY)) },
    clearApiKey: async () => { await run('readwrite', (s) => s.delete(API_KEY)) },
  }
}
