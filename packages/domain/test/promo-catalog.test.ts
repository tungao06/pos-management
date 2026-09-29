import { describe, expect, it } from 'vitest'
import { PROMO_RULE_VERSIONS } from '@dayo/dayo-pricing'
import { CONTRACT_PROMO_RULE_VERSIONS, PosCatalogResponse } from '@dayo/contracts'
import { listContractFixtures, loadContractFixture, loadRichCatalog } from '@dayo/contracts/fixture-files'
import { basename } from 'node:path'
import { toPricingCatalog, type CartDraft, type PosOrderCatalog } from '../src/price-cart.js'
import { checkCatalogRules, selectableManualPromotions, TABLET_PROMO_RULE_VERSION } from '../src/promo-catalog.js'
import * as domain from '../src/index.js'
import { POS_CATALOG } from './fixtures/pos-catalog.js'
import { PROMO, promoRulesCatalog } from './fixtures/promo-rules-catalog.js'

const CAT = promoRulesCatalog()
const FRI_1030 = '2026-09-25T03:30:00.000Z' // Friday 10:30 Bangkok
/** A clone of the promo-rules catalog with one promotion edited — `raw` lets a test put what the type forbids (dayo sent it). */
const editPromo = (id: string, edit: (p: Record<string, unknown>) => void, c: PosOrderCatalog = CAT): PosOrderCatalog => {
  const x = structuredClone(c)
  edit(x.promotions.find((p) => p.id === id)! as unknown as Record<string, unknown>)
  return x
}
const cart = (over: Partial<CartDraft> = {}): CartDraft => ({
  channelCode: 'store', paymentCode: 'cash', lines: [], billDiscount: null, promoCode: null, skipPromotionIds: [], noPromotions: false,
  manualPromotionIds: [], manualPromotionReason: null, ...over,
})

describe('TABLET_PROMO_RULE_VERSION (plan 10 §0.2 E1 request · owner Q5 = 2)', () => {
  it('is the highest rule version of the vendored engine, and the contract knows the shape of every version up to it', () => {
    expect(TABLET_PROMO_RULE_VERSION).toBe(Math.max(...PROMO_RULE_VERSIONS))
    expect(TABLET_PROMO_RULE_VERSION).toBe(2)
    expect([...CONTRACT_PROMO_RULE_VERSIONS]).toEqual([...PROMO_RULE_VERSIONS])
  })
  it('is exported from the package index with checkCatalogRules and selectableManualPromotions', () => {
    expect([domain.TABLET_PROMO_RULE_VERSION, typeof domain.checkCatalogRules, typeof domain.selectableManualPromotions, typeof domain.zeroTotalVerdict]).toEqual([2, 'function', 'function', 'function'])
  })
})

describe('checkCatalogRules: a catalog the engine cannot read is refused whole (ruling R12)', () => {
  const e1Catalogs = listContractFixtures().flatMap((f) => {
    const name = basename(f, '.json')
    const r = PosCatalogResponse.safeParse(loadContractFixture(name).response.body)
    return r.success && r.data.data.changed ? [[name, toPricingCatalog(r.data.data.catalog)] as const] : []
  })
  it('finds the E1 catalogs of the contract fixtures (the loop below is not vacuous)', () => {
    expect(e1Catalogs.map(([n]) => n)).toEqual(expect.arrayContaining(['e1-catalog-changed', 'e1-catalog-changed-old-dayo', 'e1-catalog-changed-promo-rules']))
  })
  it.each(e1Catalogs)('contract fixture %s: no problem', (_n, c) => { expect(checkCatalogRules(c)).toEqual([]) })
  it('the POS test catalogs: no problem', () => {
    expect(checkCatalogRules(POS_CATALOG)).toEqual([])
    expect(checkCatalogRules(toPricingCatalog(loadRichCatalog().catalog))).toEqual([])
  })
  it('a rule vendor validatePromoRule refuses is a problem naming the promotion', () => {
    const c = editPromo(PROMO.M_FREE, (p) => { p['rule'] = { v: 1, scope: 'cup', target: {}, reward: { type: 'percent', percent: 150 } } })
    const problems = checkCatalogRules(c)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.every((s) => s.includes(PROMO.M_FREE))).toBe(true)
  })
  it('an unknown key in a rule is a problem (the contract keeps it for this check)', () => {
    const c = editPromo(PROMO.M_5, (p) => { p['rule'] = { ...(p['rule'] as object), surprise: true } })
    expect(checkCatalogRules(c)).toHaveLength(1)
  })
  it('rule.v above the tablet\'s version is a problem of its own', () => {
    const c = editPromo(PROMO.TIERED, (p) => { p['rule'] = { ...(p['rule'] as object), v: TABLET_PROMO_RULE_VERSION + 1 } })
    expect(checkCatalogRules(c)).toEqual(expect.arrayContaining([expect.stringContaining(`rule.v ${TABLET_PROMO_RULE_VERSION + 1}`)]))
  })
  it('rule.v that is not the minimum the rule needs is a problem (vendor: v must be 1 for a v1 reward)', () => {
    const c = editPromo(PROMO.M_5, (p) => { p['rule'] = { ...(p['rule'] as object), v: 2 } })
    expect(checkCatalogRules(c)).toHaveLength(1)
  })
  it('a bad time window is a problem; legacy promotions without timeWindows are read by the engine from daysOfWeek/timeFrom', () => {
    const c = editPromo(PROMO.MATCHA_EVENING, (p) => { p['timeWindows'] = [{ days: [], from: '25:00', to: '20:00' }] })
    expect(checkCatalogRules(c)).toEqual([expect.stringContaining(PROMO.MATCHA_EVENING)])
    expect(checkCatalogRules(editPromo(PROMO.MATCHA_EVENING, (p) => { p['timeWindows'] = null }))).toEqual([])
  })
  it('a groupCode that is not a group of the catalog is a problem; main needs no group row', () => {
    expect(checkCatalogRules(editPromo(PROMO.M_5, (p) => { p['groupCode'] = 'ghost' }))).toEqual([expect.stringContaining('ghost')])
    const noGroups: PosOrderCatalog = { ...CAT, promotions: CAT.promotions.filter((p) => (p.groupCode ?? 'main') === 'main') }
    delete noGroups.promotionGroups
    expect(checkCatalogRules(noGroups)).toEqual([])
    const stackWithoutGroups: PosOrderCatalog = { ...CAT }
    delete stackWithoutGroups.promotionGroups
    expect(checkCatalogRules(stackWithoutGroups).filter((s) => s.includes('stack')).length).toBe(2)
  })
  it('a legacy promotion with no rule is fine (the engine reads it with promoFromLegacy)', () => {
    const c = editPromo(PROMO.B2G1, (p) => { delete p['rule']; delete p['template']; delete p['timeWindows']; delete p['groupCode'] })
    expect(checkCatalogRules(c)).toEqual([])
  })
})

describe('selectableManualPromotions (ADR-0070 rule 3): what the staff may pick for this bill now', () => {
  const pick = (c: PosOrderCatalog, over: Partial<CartDraft> = {}, at = FRI_1030): string[] => selectableManualPromotions(cart(over), c, at).map((p) => p.promotionId)
  it('only manual promotions whose conditions hold — never auto or code ones', () => {
    expect(selectableManualPromotions(cart(), CAT, FRI_1030)).toEqual([
      { promotionId: PROMO.M_FREE, code: null, name: 'ชงผิด ฟรีแก้วใหม่ (เลือกเอง)', usageLimitTotal: null, usageLimitPerDay: null },
      { promotionId: PROMO.M_5, code: null, name: 'ลดชาไทย 5 บาท (เลือกเอง)', usageLimitTotal: null, usageLimitPerDay: null },
    ])
  })
  it('passes the usage limits through for display (the tablet never counts uses)', () => {
    const c = editPromo(PROMO.M_5, (p) => { p['usageLimitTotal'] = 10; p['usageLimitPerDay'] = 2 })
    expect(selectableManualPromotions(cart(), c, FRI_1030).find((p) => p.promotionId === PROMO.M_5)).toMatchObject({ usageLimitTotal: 10, usageLimitPerDay: 2 })
  })
  it('noPromotions = none · a skipped one is not offered · another channel is not offered', () => {
    expect(pick(CAT, { noPromotions: true })).toEqual([])
    expect(pick(CAT, { skipPromotionIds: [PROMO.M_5] })).toEqual([PROMO.M_FREE])
    expect(pick(editPromo(PROMO.M_5, (p) => { p['channelCodes'] = ['grab'] }))).toEqual([PROMO.M_FREE])
  })
  it('time windows at the sale instant, from HH:MM inclusive (dayo is the authority — carried item 4)', () => {
    const c = editPromo(PROMO.M_5, (p) => { p['timeWindows'] = [{ days: [], from: '17:00', to: '20:00' }] })
    expect(pick(c, {}, '2026-09-25T09:59:00.000Z')).toEqual([PROMO.M_FREE]) // 16:59
    expect(pick(c, {}, '2026-09-25T10:00:00.000Z')).toEqual([PROMO.M_FREE, PROMO.M_5]) // 17:00
  })
  it('an inactive manual promotion is not offered', () => {
    expect(pick(editPromo(PROMO.M_FREE, (p) => { p['isActive'] = false }))).toEqual([PROMO.M_5])
  })
  it('the result type is exactly the brief\'s', () => {
    const r: { promotionId: string; code: string | null; name: string; usageLimitTotal: number | null; usageLimitPerDay: number | null }[] = selectableManualPromotions(cart(), CAT, FRI_1030)
    expect(Object.keys(r[0]!).sort()).toEqual(['code', 'name', 'promotionId', 'usageLimitPerDay', 'usageLimitTotal'])
  })
})

