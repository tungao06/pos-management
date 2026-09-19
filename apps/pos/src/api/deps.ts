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
}

export const PROD_PIN_COST: PinCost = { t: 2, m: 19_456 }
