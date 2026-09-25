import type { SecretStore } from '../sync/secret-store'

export type PinCost = { t: number; m: number }

export type ApiDeps = {
  /** ISO-8601 UTC timestamp. */
  now: () => string
  /** UUIDv7 in production, sequential ids in tests. */
  newId: () => string
  /** argon2id cost for PIN hashing (decision T8). */
  pinCost: PinCost
  /** The whole database file (opfs-sahpool `exportFile` in the Worker · `VACUUM INTO` in tests) — spec §11, spike I3. */
  exportDbFile: () => Promise<Uint8Array>
  /** Worker: globalThis.fetch bound · tests: the mock's fetch (or one that is always offline). */
  fetch: typeof fetch
  /** The dayo API key — IndexedDB in the Worker, never SQLite (spec 04 §7 ข้อ 1) · tests: in memory. */
  secrets: SecretStore
  /** Backoff jitter in [0, 1) · tests: () => 0.5. */
  random: () => number
  /** Task 14 sets it to wake the sender 2 s after a save. */
  afterWrite?: () => void
}

export const PROD_PIN_COST: PinCost = { t: 2, m: 19_456 }
