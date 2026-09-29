import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ShiftCashParityFile } from '@dayo/contracts'
import { edgeBahtToSatang, edgeSatangToBaht } from '../src/money-edge'
import { expectedCashSatang, varianceNeedsReason, type CashInputs } from '../src/shift'

const file = ShiftCashParityFile.parse(JSON.parse(readFileSync(fileURLToPath(new URL('../../contracts/fixtures/parity/pos-shift-cash-parity.json', import.meta.url)), 'utf8')))
/** D102 at the default ฿20 — tablet-only expectations kept here, not in the shared file (its shape is fixed with dayo). */
const NEEDS_REASON_AT_20: Record<string, boolean> = {
  'ขายเงินสดอย่างเดียว นับตรง': false, 'สถานการณ์แผน 3b + บิลบอท ขาด 0.50': false, 'เงินคืน เงินเข้า จ่ายออก นำออก ขาดพอดี 20.00': true,
  'ขาด 19.99 ไม่ต้องมีเหตุผล': false, 'ติดลบ — จ่ายออกเกินเงินในลิ้นชัก (D54 Q3b-14)': true, 'ติดลบพร้อมบิลบอท': true,
  'ค่าที่ float ชอบพลาด': false, 'ค่าใช้จ่ายจากลิ้นชัก (ก้อน 4)': false,
}
type Wire = (typeof file.cases)[number]['cash']

/** dayo's formula exactly as numeric(10,2): decimal text → integer cents (BigInt), no float on the way (spec §4.10). */
function cents(v: number): bigint {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(v.toFixed(2))
  if (m === null) throw new Error(`not money: ${v}`)
  const c = BigInt(m[2]!) * 100n + BigInt((m[3] ?? '').padEnd(2, '0'))
  return m[1] === '-' ? -c : c
}
function dayoExpected(c: Wire): bigint {
  return cents(c.opening_float) + cents(c.pos_cash_sales) - cents(c.void_refunds) + cents(c.paid_in) - cents(c.paid_out) - cents(c.drops) - cents(c.drawer_expenses) + cents(c.bot_cash)
}
function tablet(c: Wire): CashInputs {
  return {
    openingFloatSatang: edgeBahtToSatang(c.opening_float), cashSalesSatang: edgeBahtToSatang(c.pos_cash_sales), voidRefundsSatang: edgeBahtToSatang(c.void_refunds),
    paidInSatang: edgeBahtToSatang(c.paid_in), paidOutSatang: edgeBahtToSatang(c.paid_out), dropsSatang: edgeBahtToSatang(c.drops),
    drawerExpensesSatang: edgeBahtToSatang(c.drawer_expenses), botCashSatang: edgeBahtToSatang(c.bot_cash),
  }
}

describe('expected cash parity with dayo (spec 04 §4.10 · R-m1 · D84 fixture)', () => {
  it.each(file.cases.map((c) => [c.name, c] as const))('%s', (_, c) => {
    const expected = expectedCashSatang(tablet(c.cash))
    expect(BigInt(expected)).toBe(dayoExpected(c.cash))
    expect(BigInt(expected)).toBe(cents(c.expected))                 // hand-computed in the fixture
    const variance = edgeBahtToSatang(c.counted) - expected
    expect(BigInt(variance)).toBe(cents(c.variance))
    if (c.name in NEEDS_REASON_AT_20) expect(varianceNeedsReason(variance, 2_000)).toBe(NEEDS_REASON_AT_20[c.name]) // D102 ≥
  })
  it('every D102 expectation still names a case of the shared file', () => {
    expect(Object.keys(NEEDS_REASON_AT_20).every((n) => file.cases.some((c) => c.name === n))).toBe(true)
  })
  it('the fixture has a negative expected-cash case (D54 Q3b-14)', () => {
    expect(file.cases.some((c) => c.expected < 0)).toBe(true)
  })
  it('property: any non-negative components give the same satang both ways', () => {
    const money = fc.integer({ min: 0, max: 10_000_000 })
    fc.assert(fc.property(fc.tuple(money, money, money, money, money, money, money, money), (v) => {
      const [of, pos, vr, pin, pout, dr, dex, bot] = v
      const x: CashInputs = { openingFloatSatang: of, cashSalesSatang: pos, voidRefundsSatang: vr, paidInSatang: pin, paidOutSatang: pout, dropsSatang: dr, drawerExpensesSatang: dex, botCashSatang: bot }
      const wire = { opening_float: edgeSatangToBaht(of), pos_cash_sales: edgeSatangToBaht(pos), void_refunds: edgeSatangToBaht(vr), paid_in: edgeSatangToBaht(pin), paid_out: edgeSatangToBaht(pout), drops: edgeSatangToBaht(dr), drawer_expenses: edgeSatangToBaht(dex), bot_cash: edgeSatangToBaht(bot) }
      return BigInt(expectedCashSatang(x)) === dayoExpected(wire)
    }), { numRuns: 20_000 })
  })
})
