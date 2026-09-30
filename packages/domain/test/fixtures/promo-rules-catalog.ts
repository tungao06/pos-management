import { PosCatalogResponse } from '@dayo/contracts'
import { loadContractFixture } from '@dayo/contracts/fixture-files'
import { toPricingCatalog, type PosOrderCatalog } from '../../src/price-cart.js'

/**
 * The E1 catalog of dayo f4cda56 at promo_rule_version 2 (contracts fixture e1-catalog-changed-promo-rules, plan 10 T2):
 * both promotion shapes, two groups (main separate · stack), two manual promotions. Never re-type a catalog in a test —
 * a test that needs a variation clones this one and edits the clone.
 */
export const promoRulesCatalog = (): PosOrderCatalog => {
  const d = PosCatalogResponse.parse(loadContractFixture('e1-catalog-changed-promo-rules').response.body).data
  if (!d.changed) throw new Error('e1-catalog-changed-promo-rules must be changed:true')
  return toPricingCatalog(d.catalog)
}

/** Promotion ids of that catalog. */
export const PROMO = {
  /** auto · main · Thai Tea buy 2 get 1 (legacy shape + rule) */
  B2G1: '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f',
  /** auto · main · Matcha 10% 17:00–20:00 */
  MATCHA_EVENING: '2b3c4d5e-6f70-4812-9a3b-4c5d6e7f8091',
  /** auto · stack · Thai Tea tiered 10%/15% (rule only, v2) · Fri/Sat 22:00–02:00 + all Sunday · usage limits 500/50 */
  TIERED: '3a3a3a3a-0000-4000-8000-000000000003',
  /** manual · main · any cup 100% ("ชงผิด ฟรีแก้วใหม่") */
  M_FREE: '5c5c5c5c-0000-4000-8000-000000000004',
  /** manual · stack · Thai Tea −฿5 (rule only) */
  M_5: '5c5c5c5c-0000-4000-8000-000000000005',
} as const
