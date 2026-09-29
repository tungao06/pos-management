import { describe, expect, it } from 'vitest'
import * as domain from '../src/index'
import { BOT_ORDER_NO_RE } from '@dayo/contracts'
import {
  BOT_ORDER_NO_PATTERN, buildZReport, cashInputsFromMovements, cashVarianceSatang, effectiveVarianceAlertSatang, expectedCashSatang, MAX_BOT_BILLS,
  MIN_VARIANCE_ALERT_SATANG, summarizeShiftSales, varianceNeedsReason, withBotCash, zReportHash, type CashInputs, type ZBotBill, type ZChainWarning, type ZInput,
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

describe('fix round 1 — bot bills exactly as dayo accepts them (0066 bot_bills · security M-1)', () => {
  const b = zInput().botBills[0]!
  const bills = (n: number, total: number): ZBotBill[] => Array.from({ length: n }, (_, i) => ({ ...b, orderNo: `L260925-${String(i).padStart(3, '0')}`, totalSatang: total }))
  it('the order-number pattern is the one contracts and dayo use', () => {
    expect(BOT_ORDER_NO_PATTERN.source).toBe('^L\\d{6}-\\d{3,}$')
    expect(BOT_ORDER_NO_PATTERN).toBe(BOT_ORDER_NO_RE) // fix round 1 item 4: one pattern, owned by contracts — the line above pins it to dayo's
    expect(MAX_BOT_BILLS).toBe(500)
  })
  it('at most 500 bills', () => {
    expect(buildZReport(zInput({ botBills: bills(500, 7) }), null).snapshot.botBills).toHaveLength(500) // 500 × 7 = 3_500
    expect(() => buildZReport(zInput({ botBills: [...bills(500, 7), { ...b, orderNo: 'L260925-999', totalSatang: 0 }] }), null)).toThrow(/500/)
  })
  it('version is a whole number 1..2147483647', () => {
    expect(buildZReport(zInput({ botBills: [{ ...b, version: 2_147_483_647 }] }), null).snapshot.botBills[0]!.version).toBe(2_147_483_647)
    for (const version of [0, -1, 2_147_483_648, 1.5]) expect(() => buildZReport(zInput({ botBills: [{ ...b, version }] }), null)).toThrow(/version/)
  })
  it('orderNo matches ^L\\d{6}-\\d{3,}$', () => {
    expect(buildZReport(zInput({ botBills: [{ ...b, orderNo: 'L260925-0013' }] }), null).snapshot.botBills[0]!.orderNo).toBe('L260925-0013')
    for (const orderNo of ['X260925-013', 'L26092-013', 'L260925-01', ' L260925-013', 'L260925-013 ', 'L260925-013\n', 'l260925-013', 'L２60925-013']) {
      expect(() => buildZReport(zInput({ botBills: [{ ...b, orderNo }] }), null)).toThrow(/orderNo/)
    }
  })
  it('every bill is checked before duplicates are looked for', () => {
    expect(() => buildZReport(zInput({ botBills: [{ ...b, totalSatang: 1_500 }, { ...b, totalSatang: 2_000, version: 0 }] }), null)).toThrow(/version/)
    expect(() => buildZReport(zInput({ botBills: [{ ...b, totalSatang: 1_500 }, { ...b, totalSatang: 2_000 }] }), null)).toThrow(/twice/)
  })
  it('the other frozen fields must have their declared types', () => {
    const bad = (over: Record<string, unknown>): ZInput => zInput({ botBills: [{ ...b, ...over } as ZBotBill] })
    expect(() => buildZReport(bad({ source: 1 }), null)).toThrow(/source/)
    expect(() => buildZReport(bad({ soldAt: 5 }), null)).toThrow(/soldAt/)
    expect(() => buildZReport(bad({ createdByName: {} }), null)).toThrow(/createdByName/)
    expect(buildZReport(bad({ soldAt: null, createdByName: 'แอดมิน' }), null).snapshot.botBills[0]).toMatchObject({ soldAt: null, createdByName: 'แอดมิน' })
  })
  it('extra properties on a caller bill never reach the snapshot or the hash', () => {
    const clean = buildZReport(zInput(), null)
    const dirty = buildZReport(zInput({ botBills: [{ ...b, hack: 'x' } as ZBotBill] }), null)
    expect(Object.keys(dirty.snapshot.botBills[0]!).sort()).toEqual(['createdByName', 'orderNo', 'soldAt', 'source', 'totalSatang', 'version'])
    expect(dirty.hash).toBe(clean.hash)
  })
  it('the frozen bill is a copy — changing the caller object afterwards changes nothing', () => {
    const mine = { ...b }
    const z = buildZReport(zInput({ botBills: [mine] }), null)
    mine.totalSatang = 9_999
    expect(z.snapshot.botBills[0]!.totalSatang).toBe(3_500)
    expect(zReportHash(z.snapshot)).toBe(z.hash)
  })
  it('the frozen window has exactly after and until', () => {
    const win = { ...zInput().botWindow!, hack: 1 }
    const z = buildZReport(zInput({ botWindow: win }), null)
    expect(z.snapshot.botWindow).toEqual({ after: '2026-09-24T17:00:00.000Z', until: '2026-09-25T12:00:00.000Z' })
    expect(z.hash).toBe(buildZReport(zInput(), null).hash)
  })
  it('refuses a bot bill list that is not an array or holds a non-object', () => {
    expect(() => buildZReport(zInput({ botBills: null as unknown as ZBotBill[] }), null)).toThrow(/botBills/)
    expect(() => buildZReport(zInput({ botBills: [null as unknown as ZBotBill] }), null)).toThrow(/bot bill/)
  })
})

describe('fix round 1 — instants are ISO UTC (security L-1 · ruling P7)', () => {
  const localOnly = { botWindow: null, botBills: [], cash: cashInputsFromMovements(50_000, sales.cashSalesSatang, []), countedCashSatang: 60_000, countLines: [{ denominationSatang: 50_000, count: 1 }, { denominationSatang: 10_000, count: 1 }] }
  it.each([
    '2026-09-25', '2026-09-25T12:00:00', '2026-09-25 12:00:00Z', '2026-09-25T19:00:00+07:00', '2026-09-25T12:00:00.0000Z',
    '2026-09-25T12:00:00-00:00', '2026-02-30T12:00:00.000Z', '2026-09-25T24:00:00.000Z',
  ])('countedAt %s is refused', (countedAt) => {
    expect(() => buildZReport(zInput({ ...localOnly, countedAt }), null)).toThrow(/countedAt is not an ISO UTC instant/)
  })
  it('openedAt, closedAt and the window ends are held to the same form', () => {
    expect(() => buildZReport(zInput({ openedAt: '2026-09-25' }), null)).toThrow(/openedAt/)
    expect(() => buildZReport(zInput({ closedAt: '2026-09-25T12:05:00' }), null)).toThrow(/closedAt/)
    expect(() => buildZReport(zInput({ botWindow: { after: '2026-09-24', until: '2026-09-25T12:00:00.000Z' } }), null)).toThrow(/botWindow.after/)
    expect(() => buildZReport(zInput({ botWindow: { after: '2026-09-24T17:00:00.000Z', until: '2026-09-25T19:00:00.000+07:00' } }), null)).toThrow(/botWindow.until/)
  })
  it('accepts Z and +00:00, with or without milliseconds, and compares until with countedAt as instants', () => {
    const z = buildZReport(zInput({ openedAt: '2026-09-25T02:00:00+00:00', botWindow: { after: '2026-09-24T17:00:00.000+00:00', until: '2026-09-25T12:00:00+00:00' } }), null)
    expect(z.snapshot.botWindow).toEqual({ after: '2026-09-24T17:00:00.000+00:00', until: '2026-09-25T12:00:00+00:00' })
    expect(buildZReport(zInput({ ...localOnly, countedAt: '2026-09-25T12:00:00.5Z', closedAt: '2026-09-25T12:00:00.500+00:00' }), null).snapshot.countedAt).toBe('2026-09-25T12:00:00.5Z')
    expect(() => buildZReport(zInput({ botWindow: { after: '2026-09-24T17:00:00.000Z', until: '2026-09-25T12:00:00.001+00:00' } }), null)).toThrow(/until/)
  })
})

describe('fix round 1 — centralLastZ must be the Z this one continues (security L-2 · R9)', () => {
  const w: ZChainWarning = { brokenShiftId: 'central', storedGrandTotalSatang: null, recomputedGrandTotalSatang: 0, acknowledgedBy: 'u1', unreadableZs: [], duplicateZNos: [], duplicateZNosTruncated: false, missingZNos: [], missingZNosTruncated: false, deletedShiftIds: [], deletedShiftIdsTruncated: false, zNoGap: 41 }
  const hash = 'ab'.repeat(32)
  it('refuses a null or non-object centralLastZ', () => {
    for (const centralLastZ of [null, 'x', 41]) {
      expect(() => buildZReport(zInput({ zNo: 42, chainWarning: { ...w, centralLastZ } as unknown as ZChainWarning }), { zNo: 41, grandTotalSatang: 0 })).toThrow(RangeError)
    }
  })
  it('refuses a centralLastZ.zNo other than the previous Z number', () => {
    expect(() => buildZReport(zInput({ zNo: 42, chainWarning: { ...w, centralLastZ: { zNo: 40, hash } } }), { zNo: 41, grandTotalSatang: 0 })).toThrow(/centralLastZ/)
    expect(() => buildZReport(zInput({ zNo: 42, chainWarning: { ...w, centralLastZ: { zNo: 42, hash } } }), { zNo: 41, grandTotalSatang: 0 })).toThrow(/centralLastZ/)
    expect(() => buildZReport(zInput({ chainWarning: { ...w, zNoGap: 0, centralLastZ: { zNo: 1, hash } } }), null)).toThrow(/centralLastZ/)
  })
  it('refuses a non-string hash', () => {
    expect(() => buildZReport(zInput({ zNo: 42, chainWarning: { ...w, centralLastZ: { zNo: 41, hash: 5 } } as unknown as ZChainWarning }), { zNo: 41, grandTotalSatang: 0 })).toThrow(/centralLastZ/)
  })
})

describe('fix round 1 — expected cash stays exact at every step (security L-3)', () => {
  it('refuses a sum that leaves the safe range part-way, even if it would come back', () => {
    expect(() => expectedCashSatang({ ...cash0, openingFloatSatang: Number.MAX_SAFE_INTEGER, cashSalesSatang: 1, voidRefundsSatang: 1 })).toThrow(RangeError)
    expect(() => expectedCashSatang({ ...cash0, paidOutSatang: Number.MAX_SAFE_INTEGER, dropsSatang: 1, botCashSatang: 1 })).toThrow(RangeError)
  })
  it('refuses fractional terms even when they cancel out', () => {
    expect(() => expectedCashSatang({ ...cash0, paidInSatang: 0.5, paidOutSatang: 0.5 })).toThrow(RangeError)
  })
  it('the edges of the safe range are fine', () => {
    expect(expectedCashSatang({ ...cash0, openingFloatSatang: Number.MAX_SAFE_INTEGER })).toBe(Number.MAX_SAFE_INTEGER)
    expect(expectedCashSatang({ ...cash0, paidOutSatang: Number.MAX_SAFE_INTEGER })).toBe(-Number.MAX_SAFE_INTEGER)
  })
})
