import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ParityFile } from '@dayo/contracts'
import { CartError, cartFromOrderDraft, edgeBahtToSatang, priceCart, toPricingCatalog } from '../src/index.js'

const REAL = fileURLToPath(new URL('../../dayo-pricing/fixtures/pos-parity.json', import.meta.url))
const SEED = fileURLToPath(new URL('../../dayo-pricing/fixtures/pos-parity.seed.json', import.meta.url))
const FILE = existsSync(REAL) ? REAL : SEED
const parity = ParityFile.parse(JSON.parse(readFileSync(FILE, 'utf8')))
const catalog = toPricingCatalog(parity.catalog)
const vendor = JSON.parse(readFileSync(fileURLToPath(new URL('../../dayo-pricing/VENDOR.json', import.meta.url)), 'utf8')) as { files: Record<string, string> }
/** Cases whose draft the tablet can never build (e.g. qty above maxQtyPerLine that dayo clamps). Each entry needs a reason and the head's OK. */
const TABLET_UNREACHABLE = new Map<string, string>([])

describe(`parity layer C (spec 04 §5.2) — ${FILE === REAL ? 'dayo export' : 'POS SEED: wrapper check only, NOT the block-2 gate'}`, () => {
  it('the fixture was made with the vendored pricing version', () => {
    expect(parity.pricing_files_sha256, 'ตัวคิดราคาในเครื่องไม่ตรงรุ่นกับ dayo').toEqual(vendor.files)
  })
  for (const c of parity.cases) {
    const skip = TABLET_UNREACHABLE.get(c.spec)
    it.skipIf(skip !== undefined)(`${c.id}: 0 satang difference on every money field`, () => {
      let priced
      try {
        const { cart, soldAt } = cartFromOrderDraft(c.draft, catalog)
        priced = priceCart(cart, catalog, soldAt)
      } catch (e) {
        if (!(e instanceof CartError)) throw e
        expect(c.expected.ok, `the tablet refuses ${c.id} (${e.code}) but dayo accepts it`).toBe(false)
        return
      }
      expect(priced.ok).toBe(c.expected.ok)
      if (!c.expected.ok) return
      const e = c.expected
      expect({
        itemsSubtotal: priced.itemsSubtotalSatang, itemsDiscount: priced.itemsDiscountSatang, billDiscountAmount: priced.billDiscountSatang,
        totalAmount: priced.totalSatang, channelFeeAmount: priced.channelFeeSatang,
        lines: priced.lines.map((l) => [l.lineNo, l.unitPriceSatang, l.discountPerCupSatang, l.lineTotalSatang]),
        promotionsApplied: priced.promotionsApplied.map((p) => [p.promotionId, p.discountSatang]),
      }).toEqual({
        itemsSubtotal: edgeBahtToSatang(e.itemsSubtotal), itemsDiscount: edgeBahtToSatang(e.itemsDiscount), billDiscountAmount: edgeBahtToSatang(e.billDiscountAmount),
        totalAmount: edgeBahtToSatang(e.totalAmount), channelFeeAmount: edgeBahtToSatang(e.channelFeeAmount),
        lines: e.lines.map((l) => [l.lineNo, edgeBahtToSatang(l.unitPrice), edgeBahtToSatang(l.discountPerCup), edgeBahtToSatang(l.lineTotal)]),
        promotionsApplied: e.promotionsApplied.map((p) => [p.promotionId, edgeBahtToSatang(p.discountAmount)]),
      })
    })
  }
})
