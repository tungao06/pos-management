import { describe, expect, it } from 'vitest'
import * as domain from '../src/index'
import {
  buildZReport, cashInputsFromMovements, cashVarianceSatang, effectiveVarianceAlertSatang, expectedCashSatang, MIN_VARIANCE_ALERT_SATANG,
  summarizeShiftSales, varianceNeedsReason, withBotCash, type CashInputs, type ZInput,
} from '../src/shift'

const cash0: CashInputs = { openingFloatSatang: 0, cashSalesSatang: 0, voidRefundsSatang: 0, paidInSatang: 0, paidOutSatang: 0, dropsSatang: 0, drawerExpensesSatang: 0, botCashSatang: 0 }

describe('expected cash with bot cash and drawer expenses (spec 04 §4.10 · R-m1)', () => {
  it('each new component lands once, with its sign', () => {
    expect(expectedCashSatang({ ...cash0, botCashSatang: 1 })).toBe(1)
    expect(expectedCashSatang({ ...cash0, drawerExpensesSatang: 1 })).toBe(-1)
  })
  it('movements alone never carry bot cash or drawer expenses', () => {
    expect(cashInputsFromMovements(50_000, 13_000, [{ kind: 'PAID_OUT', amountSatang: 2_000 }])).toMatchObject({ botCashSatang: 0, drawerExpensesSatang: 0 })
  })
  it('withBotCash adds the E4 total and refuses a negative or fractional one', () => {
    expect(expectedCashSatang(withBotCash({ ...cash0, openingFloatSatang: 50_000 }, 15_550))).toBe(65_550)
    expect(() => withBotCash(cash0, -1)).toThrow(RangeError)
    expect(() => withBotCash(cash0, 0.5)).toThrow(RangeError)
  })
  it('goes negative when more was paid out than the drawer held (D54 Q3b-14)', () => {
    expect(expectedCashSatang({ ...cash0, paidOutSatang: 30_000 })).toBe(-30_000)
  })
  it("dayo's formula, every term at once (dayo_z_expected · 0065)", () => {
    const x: CashInputs = { openingFloatSatang: 100_000, cashSalesSatang: 523_000, voidRefundsSatang: 4_500, paidInSatang: 1_000, paidOutSatang: 20_000, dropsSatang: 300_000, drawerExpensesSatang: 7_000, botCashSatang: 15_550 }
    expect(expectedCashSatang(x)).toBe(100_000 + 523_000 - 4_500 + 1_000 - 20_000 - 300_000 - 7_000 + 15_550)
  })
})

describe('cashVarianceSatang — counted − expected, the one formula (spec §4.10)', () => {
  it('negative = short, positive = over', () => {
    expect(cashVarianceSatang(61_500, 63_500)).toBe(-2_000)
    expect(cashVarianceSatang(0, -30_000)).toBe(30_000)
    expect(cashVarianceSatang(63_500, 63_500)).toBe(0)
  })
  it('refuses a negative or fractional count and a fractional expected', () => {
    expect(() => cashVarianceSatang(-1, 0)).toThrow(RangeError)
    expect(() => cashVarianceSatang(0.5, 0)).toThrow(RangeError)
    expect(() => cashVarianceSatang(0, 0.5)).toThrow(RangeError)
  })
})

describe('varianceNeedsReason uses ≥ (D102)', () => {
  it.each([[2_000, true], [-2_000, true], [1_999, false], [-1_999, false], [0, false]] as const)('variance %i at ฿20 → %s', (v, want) => {
    expect(varianceNeedsReason(v, 2_000)).toBe(want)
  })
  it('an alert below 1 satang is refused; a setting of 0 is used as 1 satang (ruling R4)', () => {
    expect(() => varianceNeedsReason(0, 0)).toThrow(RangeError)
    expect(effectiveVarianceAlertSatang(0)).toBe(1)
    expect(effectiveVarianceAlertSatang(2_000)).toBe(2_000)
    expect(varianceNeedsReason(0, effectiveVarianceAlertSatang(0))).toBe(false)
    expect(varianceNeedsReason(-1, effectiveVarianceAlertSatang(0))).toBe(true)
  })
  it('the floor is 1 satang; a negative or fractional setting is refused', () => {
    expect(MIN_VARIANCE_ALERT_SATANG).toBe(1)
    expect(() => varianceNeedsReason(0, -1)).toThrow(RangeError)
    expect(() => effectiveVarianceAlertSatang(-1)).toThrow(RangeError)
    expect(() => effectiveVarianceAlertSatang(0.5)).toThrow(RangeError)
  })
})

describe('@dayo/domain index exports the block-3 cash API', () => {
  it('has every new function and constant', () => {
    for (const name of ['withBotCash', 'cashVarianceSatang', 'effectiveVarianceAlertSatang', 'MIN_VARIANCE_ALERT_SATANG'] as const) {
      expect(domain[name]).toBeDefined()
    }
  })
})

const sales = summarizeShiftSales([{ id: 'o1', status: 'paid', subtotalSatang: 10_000, discountSatang: 0, totalSatang: 10_000, payments: [{ method: 'CASH', amountSatang: 10_000 }] }])
const COUNT_635 = [{ denominationSatang: 50_000, count: 1 }, { denominationSatang: 10_000, count: 1 }, { denominationSatang: 2_000, count: 1 }, { denominationSatang: 1_000, count: 1 }, { denominationSatang: 500, count: 1 }]
function zInput(over: Partial<ZInput> = {}): ZInput {
  return {
    shiftId: 's1', businessDate: '2026-09-25', deviceId: 'd1', zNo: 1, openedAt: '2026-09-25T02:00:00.000Z', openedBy: 'u1', openedQuick: false,
    countedAt: '2026-09-25T12:00:00.000Z', closedAt: '2026-09-25T12:05:00.000Z', closedBy: 'u1', countedBy: 'u2',
    sales, cash: withBotCash(cashInputsFromMovements(50_000, sales.cashSalesSatang, []), 3_500),
    countLines: COUNT_635, countedCashSatang: 63_500, varianceAlertSatang: 2_000, varianceReason: null, voids: [], bankQrTotalSatang: null, chainWarning: null,
    botWindow: { after: '2026-09-24T17:00:00.000Z', until: '2026-09-25T12:00:00.000Z' },
    botBills: [{ orderNo: 'L260925-013', version: 1, source: 'line', soldAt: '2026-09-25T05:00:00+00:00', totalSatang: 3_500, createdByName: null }],
    ...over,
  }
}

describe('buildZReport with the count time and the bot window (D101 · spec §4.10 z_report)', () => {
  it('expected cash includes the bot bills; the snapshot freezes them', () => {
    const { snapshot } = buildZReport(zInput(), null)
    expect(snapshot).toMatchObject({ expectedCashSatang: 63_500, cashVarianceSatang: 0, countedAt: '2026-09-25T12:00:00.000Z', botBills: [{ orderNo: 'L260925-013', totalSatang: 3_500 }] })
  })
  it('the snapshot keeps countedAt, botWindow and botBills right after countedBy (M-5 explicit list)', () => {
    const keys = Object.keys(buildZReport(zInput(), null).snapshot)
    const at = keys.indexOf('countedBy')
    expect(keys.slice(at, at + 4)).toEqual(['countedBy', 'countedAt', 'botWindow', 'botBills'])
  })
  it('refuses bot bills that do not add up to cash.botCashSatang', () => {
    expect(() => buildZReport(zInput({ botBills: [] }), null)).toThrow(/botCashSatang/)
  })
  it('refuses a window that does not end at countedAt, or does not move forward', () => {
    expect(() => buildZReport(zInput({ botWindow: { after: '2026-09-24T17:00:00.000Z', until: '2026-09-25T12:00:01.000Z' } }), null)).toThrow(/until/)
    expect(() => buildZReport(zInput({ botWindow: { after: '2026-09-25T12:00:00.000Z', until: '2026-09-25T12:00:00.000Z' } }), null)).toThrow(/after/)
  })
  it('refuses times that are not instants', () => {
    expect(() => buildZReport(zInput({ countedAt: 'nope', botWindow: null, botBills: [], cash: cashInputsFromMovements(50_000, sales.cashSalesSatang, []) }), null)).toThrow(/countedAt/)
    expect(() => buildZReport(zInput({ botWindow: { after: 'nope', until: '2026-09-25T12:00:00.000Z' } }), null)).toThrow(/botWindow.after/)
  })
  it('a local-only Z (no window) carries no bot bills (ruling R6)', () => {
    const local = zInput({ botWindow: null, botBills: [], cash: cashInputsFromMovements(50_000, sales.cashSalesSatang, []), countedCashSatang: 60_000, countLines: [{ denominationSatang: 50_000, count: 1 }, { denominationSatang: 10_000, count: 1 }] })
    expect(buildZReport(local, null).snapshot.botWindow).toBeNull()
    expect(() => buildZReport({ ...local, botBills: zInput().botBills }, null)).toThrow(/window/)
    expect(() => buildZReport({ ...local, cash: withBotCash(local.cash, 3_500) }, null)).toThrow(/window/)
  })
  it('refuses times out of order: counted before opened, closed before counted', () => {
    expect(() => buildZReport(zInput({ countedAt: '2026-09-25T01:59:59.999Z' }), null)).toThrow(/countedAt/)
    expect(() => buildZReport(zInput({ closedAt: '2026-09-25T11:59:59.999Z' }), null)).toThrow(/closedAt/)
  })
  it('refuses the same bot bill twice', () => {
    const b = zInput().botBills[0]!
    expect(() => buildZReport(zInput({ botBills: [{ ...b, totalSatang: 1_500 }, { ...b, totalSatang: 2_000 }] }), null)).toThrow(/twice/)
  })
  it('refuses a bot bill with a blank orderNo, a negative total or a fractional version', () => {
    const b = zInput().botBills[0]!
    expect(() => buildZReport(zInput({ botBills: [{ ...b, orderNo: '  ' }] }), null)).toThrow(/orderNo/)
    expect(() => buildZReport(zInput({ botBills: [{ ...b, totalSatang: -1 }] }), null)).toThrow(RangeError)
    expect(() => buildZReport(zInput({ botBills: [{ ...b, version: 1.5 }] }), null)).toThrow(/version/)
  })
  it('short exactly ฿20.00 needs a reason (D102)', () => {
    const short = { countLines: [{ denominationSatang: 50_000, count: 1 }, { denominationSatang: 10_000, count: 1 }, { denominationSatang: 1_000, count: 1 }, { denominationSatang: 500, count: 1 }], countedCashSatang: 61_500 }
    expect(() => buildZReport(zInput(short), null)).toThrow(/reason/)
    expect(buildZReport(zInput({ ...short, varianceReason: 'ทอนผิด' }), null).snapshot.cashVarianceSatang).toBe(-2_000)
  })
  it('refuses an alert below 1 satang', () => {
    expect(() => buildZReport(zInput({ varianceAlertSatang: 0 }), null)).toThrow(RangeError)
  })
  it('a chain warning continuing from the central last Z needs a real hash (ruling R9)', () => {
    const w = { brokenShiftId: 'central', storedGrandTotalSatang: null, recomputedGrandTotalSatang: 0, acknowledgedBy: 'u1', unreadableZs: [], duplicateZNos: [], duplicateZNosTruncated: false, missingZNos: [], missingZNosTruncated: false, deletedShiftIds: [], deletedShiftIdsTruncated: false, zNoGap: 41 }
    const ok = buildZReport(zInput({ zNo: 42, chainWarning: { ...w, centralLastZ: { zNo: 41, hash: 'ab'.repeat(32) } } }), { zNo: 41, grandTotalSatang: 0 })
    expect(ok.snapshot.chainWarning?.centralLastZ).toEqual({ zNo: 41, hash: 'ab'.repeat(32) })
    expect(() => buildZReport(zInput({ zNo: 42, chainWarning: { ...w, centralLastZ: { zNo: 41, hash: 'nothex' } } }), { zNo: 41, grandTotalSatang: 0 })).toThrow(/centralLastZ/)
    expect(() => buildZReport(zInput({ zNo: 42, chainWarning: { ...w, centralLastZ: { zNo: 0, hash: 'ab'.repeat(32) } } }), { zNo: 41, grandTotalSatang: 0 })).toThrow(/centralLastZ/)
    expect(() => buildZReport(zInput({ zNo: 42, chainWarning: { ...w, centralLastZ: { zNo: 41, hash: 'AB'.repeat(32) } } }), { zNo: 41, grandTotalSatang: 0 })).toThrow(/centralLastZ/)
  })
  it('a chain warning without centralLastZ keeps the old shape (R9 optional)', () => {
    const w = { brokenShiftId: 'x', storedGrandTotalSatang: null, recomputedGrandTotalSatang: 0, acknowledgedBy: 'u1', unreadableZs: [], duplicateZNos: [], duplicateZNosTruncated: false, missingZNos: [], missingZNosTruncated: false, deletedShiftIds: [], deletedShiftIdsTruncated: false }
    expect(buildZReport(zInput({ chainWarning: w }), null).snapshot.chainWarning).not.toHaveProperty('centralLastZ')
  })
})
