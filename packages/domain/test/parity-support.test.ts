import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { computeOrder } from '@dayo/dayo-pricing'
import * as domain from '../src/index.js'
import { priceParityCase } from '../src/parity-support.js'
import { cartFromOrderDraft } from '../src/order-draft.js'
import { priceCart, toOrderDraft, withZeroCosts } from '../src/price-cart.js'
import { edgeBahtToSatang } from '../src/money-edge.js'
import { POS_CATALOG } from './fixtures/pos-catalog.js'
import { PROMO, promoRulesCatalog } from './fixtures/promo-rules-catalog.js'

const MATCHA_NO_TIME = { saleDate: '2026-09-25', channelCode: 'store', lines: [{ code: 'Matcha Latte', qty: 1 }] }

describe('priceParityCase (dayo parity export only — never the sale path)', () => {
  it('a case with no saleTime is an error, with no way around it (R15 · gap G1: dayo\'s export gives every case a time)', () => {
    expect(() => priceParityCase(MATCHA_NO_TIME, POS_CATALOG)).toThrow(/^NO_SALE_TIME/)
    expect(() => priceParityCase(MATCHA_NO_TIME, POS_CATALOG, { dayoOnlyExhausted: true })).toThrow(/^NO_SALE_TIME/)
    // @ts-expect-error allowMissingSaleTime is gone (G1): a timeless dayo case is compared at the engine layer only
    expect(() => priceParityCase(MATCHA_NO_TIME, POS_CATALOG, { allowMissingSaleTime: true })).toThrow(/^NO_SALE_TIME/)
  })
  it('a case with a time prices exactly like priceCart at that time', () => {
    const draft = { ...MATCHA_NO_TIME, saleTime: '15:00' }
    const { cart, soldAt } = cartFromOrderDraft(draft, POS_CATALOG)
    const p = priceParityCase(draft, POS_CATALOG)
    expect(p).toEqual(priceCart(cart, POS_CATALOG, soldAt))
    expect(p.totalSatang).toBe(edgeBahtToSatang(computeOrder(toOrderDraft(cart, POS_CATALOG, soldAt), withZeroCosts(POS_CATALOG)).totalAmount))
  })
})

describe('the sale API cannot skip the sale time', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (n === 'node_modules' || n === 'dist') return []
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
  })
  it('only src/parity-support.ts of the domain, and nothing in apps/pos, mentions the parity-only options', () => {
    const scanned = [...files(join(root, 'apps/pos')), ...files(join(root, 'packages/domain/src'))]
    expect(scanned.length).toBeGreaterThan(10)
    const offenders = scanned
      .filter((p) => !p.endsWith(join('packages', 'domain', 'src', 'parity-support.ts')))
      .filter((p) => /omitSaleTime|allowMissingSaleTime|dayoOnlyExhausted|exhaustedPromotions/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(root, p))
    expect(offenders).toEqual([])
  })
  it('the package index does not re-export the parity support', () => {
    expect('priceParityCase' in domain).toBe(false)
    expect(readFileSync(fileURLToPath(new URL('../src/index.ts', import.meta.url)), 'utf8')).not.toMatch(/parity-support|priced-from-quote/)
  })
  it('priceCart takes exactly cart, catalog and sold_at', () => {
    expect(priceCart.length).toBe(3)
  })
})

describe('priceParityCase dayoOnlyExhausted (ruling R3): dayo\'s usage cases only — the sale path never counts uses', () => {
  const CAT = promoRulesCatalog()
  const draft = { saleDate: '2026-09-25', saleTime: '10:30', channelCode: 'store', lines: [{ code: 'Thai Tea', size: '16 oz', sweetness: '50%' as const, qty: 1 }], manualPromotionIds: [PROMO.M_5], exhaustedPromotions: [{ id: PROMO.M_5, scope: 'total' as const }] }
  it('without the option the exhausted list is ignored, exactly as a sale', () => {
    const p = priceParityCase(draft, CAT)
    expect(p.totalSatang).toBe(3_000)
    expect('exhaustedPromotions' in p.draft).toBe(false)
  })
  it('with it the engine sees the list and refuses the promotion as dayo does', () => {
    const p = priceParityCase(draft, CAT, { dayoOnlyExhausted: true })
    expect(p.totalSatang).toBe(3_500)
    expect(p.draft.exhaustedPromotions).toEqual([{ id: PROMO.M_5, scope: 'total' }])
    expect(p.warnings.join('\n')).toContain('ครบจำนวนครั้งแล้ว')
  })
})
