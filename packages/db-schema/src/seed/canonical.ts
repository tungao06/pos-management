import { deterministicSeedId, type SeedOpts } from './rows.js'

/**
 * The ONE namespace for ids of the Excel seed. Every device (plan 3) and the server (plan 5) seed with
 * `canonicalSeedOpts()`, so the same seed JSON gives the same reference ids everywhere; a pushed sale that points at
 * `item`/`recipe`/`product_variant` ids then matches the server's rows. Never change these values after go-live.
 */
export const SEED_ID_NAMESPACE = 'dayo-seed-v1'

/** Fixed created_at / effective_from of seeded rows, so device and server seeds are byte-identical. */
export const SEED_EFFECTIVE_FROM = '2026-01-01T00:00:00.000Z'

export function canonicalSeedOpts(): SeedOpts {
  return { newId: (kind, key) => deterministicSeedId(SEED_ID_NAMESPACE, kind, key), now: SEED_EFFECTIVE_FROM, effectiveFrom: SEED_EFFECTIVE_FROM }
}
