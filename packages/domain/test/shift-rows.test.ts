import { describe, expect, it } from 'vitest'
import { CashCountRowData, CashMovementRowData, fieldsUsed, BLOCK3_SUPPORTED_FIELDS, ShiftCloseRowData, ShiftOpenRowData } from '@dayo/contracts'
import { buildCashCountRowData, buildCashMovementRowData, buildShiftCloseRowData, buildShiftOpenRowData, MAX_Z_BOT_BILLS, ZTooLargeError, type ZPosBill } from '../src/shift-rows'
import { buildZReport, cashInputsFromMovements, MAX_BOT_BILLS, summarizeShiftSales, withBotCash, zReportHash } from '../src/shift'
import { EDGE_MAX_SATANG, MoneyEdgeError } from '../src/money-edge'

const S = '5a5a5a5a-0000-4000-8000-000000000001'
const U = '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f'
const O1 = '0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f21'
const M1 = '6b6b6b6b-0000-4000-8000-000000000001'
const C1 = '7c7c7c7c-0000-4000-8000-000000000001'

describe('shift rows (spec 04 §4.10)', () => {
  it('shift_open: baht at the edge, schema-valid, only supported fields', () => {
    const d = buildShiftOpenRowData({ shiftId: S, businessDate: '2026-09-25', openedAt: '2026-09-25T02:00:00.000Z', openedBy: U, openingFloatSatang: 50_050, quickOpen: false })
    expect(ShiftOpenRowData.parse(d)).toEqual({ shift_id: S, business_date: '2026-09-25', opened_at: '2026-09-25T02:00:00.000Z', opened_by: U, opening_float: 500.5, quick_open: false })
    expect(fieldsUsed(d).every((f) => (BLOCK3_SUPPORTED_FIELDS.shift_open as readonly string[]).includes(f))).toBe(true)
  })
  it('cash_movement: VOID_REFUND carries the bill and may have no reason; PAID_OUT needs one', () => {
    const v = buildCashMovementRowData({ movementId: M1, shiftId: S, kind: 'VOID_REFUND', amountSatang: 4_500, posOrderId: O1, reason: null, createdBy: U, createdAt: '2026-09-25T03:00:00.000Z' })
    expect(CashMovementRowData.parse(v)).toMatchObject({ kind: 'VOID_REFUND', amount: 45, pos_order_id: O1, reason: null })
    expect(() => buildCashMovementRowData({ movementId: M1, shiftId: S, kind: 'PAID_OUT', amountSatang: 2_000, posOrderId: null, reason: null, createdBy: U, createdAt: '2026-09-25T03:00:00.000Z' })).toThrow(/reason/)
  })
  it('cash_count: nine lines in baht, counted = Σ', () => {
    const d = buildCashCountRowData({ countId: C1, shiftId: S, lines: [{ denominationSatang: 50_000, count: 1 }, { denominationSatang: 500, count: 3 }], countedBy: U, countedAt: '2026-09-25T12:00:00.000Z' })
    expect(CashCountRowData.parse(d).lines).toHaveLength(9)
    expect(d).toMatchObject({ counted: 515, lines: expect.arrayContaining([{ denomination: 1000, count: 0 }, { denomination: 5, count: 3 }]) })
  })
})

describe('shift rows — what dayo 0066 would reject forever never gets built', () => {
  const mv = { movementId: M1, shiftId: S, kind: 'PAID_OUT' as const, amountSatang: 2_000, posOrderId: null, reason: 'ซื้อน้ำแข็ง', createdBy: U, createdAt: '2026-09-25T03:00:00.000Z' }
  it('shift_open: business_date must be the Thai date of opened_at (0066:96-99)', () => {
    expect(() => buildShiftOpenRowData({ shiftId: S, businessDate: '2026-09-24', openedAt: '2026-09-25T02:00:00.000Z', openedBy: U, openingFloatSatang: 0, quickOpen: true })).toThrow(/business/)
    // 23:30 Bangkok is still the same Thai day; 17:00Z is the next one
    expect(buildShiftOpenRowData({ shiftId: S, businessDate: '2026-09-26', openedAt: '2026-09-25T17:00:00.000Z', openedBy: U, openingFloatSatang: 0, quickOpen: true }).business_date).toBe('2026-09-26')
  })
  it('shift_open: a float over the numeric(10,2) cap throws at the edge', () => {
    expect(() => buildShiftOpenRowData({ shiftId: S, businessDate: '2026-09-25', openedAt: '2026-09-25T02:00:00.000Z', openedBy: U, openingFloatSatang: EDGE_MAX_SATANG + 1, quickOpen: false })).toThrow(MoneyEdgeError)
  })
  it('cash_movement: amount 0, negative or fractional is refused', () => {
    for (const amountSatang of [0, -100, 100.5]) expect(() => buildCashMovementRowData({ ...mv, amountSatang })).toThrow(/amount/)
  })
  it('cash_movement: pos_order_id only (and always) with VOID_REFUND', () => {
    expect(() => buildCashMovementRowData({ ...mv, posOrderId: O1 })).toThrow(/pos_order_id/)
    expect(() => buildCashMovementRowData({ ...mv, kind: 'VOID_REFUND', posOrderId: null })).toThrow(/pos_order_id/)
  })
  it('cash_movement: a blank reason is no reason, for every kind (dayo_pos_is_text)', () => {
    expect(() => buildCashMovementRowData({ ...mv, reason: '   ' })).toThrow(/reason/)
    expect(() => buildCashMovementRowData({ ...mv, kind: 'VOID_REFUND', posOrderId: O1, reason: ' ' })).toThrow(/reason/)
    expect(() => buildCashMovementRowData({ ...mv, reason: 'ก'.repeat(201) })).toThrow(/reason/)
    expect(buildCashMovementRowData({ ...mv, reason: 'ก'.repeat(200) }).reason).toHaveLength(200)
  })
  it('cash_movement: PAID_IN and DROP with a reason parse; fields stay within the supported list', () => {
    for (const kind of ['PAID_IN', 'DROP'] as const) {
      const d = buildCashMovementRowData({ ...mv, kind })
      expect(CashMovementRowData.parse(d)).toEqual(d)
      expect(fieldsUsed(d).every((f) => (BLOCK3_SUPPORTED_FIELDS.cash_movement as readonly string[]).includes(f))).toBe(true)
    }
  })
  it('cash_count: an unknown denomination or a count over 99,999 is refused (tallyCashCount)', () => {
    expect(() => buildCashCountRowData({ countId: C1, shiftId: S, lines: [{ denominationSatang: 25, count: 1 }], countedBy: U, countedAt: '2026-09-25T12:00:00.000Z' })).toThrow(/denomination/)
    expect(() => buildCashCountRowData({ countId: C1, shiftId: S, lines: [{ denominationSatang: 100, count: 100_000 }], countedBy: U, countedAt: '2026-09-25T12:00:00.000Z' })).toThrow(/count/)
  })
  it('cash_count: an empty drawer is nine zero lines and counted 0; fields within the supported list', () => {
    const d = buildCashCountRowData({ countId: C1, shiftId: S, lines: [], countedBy: U, countedAt: '2026-09-25T12:00:00.000Z' })
    expect(CashCountRowData.parse(d)).toMatchObject({ counted: 0 })
    expect(d.lines.map((l) => l.denomination)).toEqual([1000, 500, 100, 50, 20, 10, 5, 2, 1])
    expect(fieldsUsed(d).every((f) => (BLOCK3_SUPPORTED_FIELDS.cash_count as readonly string[]).includes(f))).toBe(true)
  })
})

function z(posCashSatang: number, bot = 3_500) {
  const sales = summarizeShiftSales([{ id: O1, status: 'paid', subtotalSatang: posCashSatang, discountSatang: 0, totalSatang: posCashSatang, payments: [{ method: 'CASH', amountSatang: posCashSatang }] }])
  const cash = withBotCash(cashInputsFromMovements(50_000, sales.cashSalesSatang, []), bot)
  const total = 50_000 + posCashSatang + bot
  return buildZReport({
    shiftId: S, businessDate: '2026-09-25', deviceId: 'd1', zNo: 3, openedAt: '2026-09-25T02:00:00.000Z', openedBy: U, openedQuick: false,
    countedAt: '2026-09-25T12:00:00.000Z', closedAt: '2026-09-25T12:05:00.000Z', closedBy: U, countedBy: U, sales, cash,
    countLines: [{ denominationSatang: 100, count: total / 100 }], countedCashSatang: total, varianceAlertSatang: 2_000, varianceReason: null,
    voids: [], bankQrTotalSatang: null, chainWarning: null,
    botWindow: { after: '2026-09-24T17:00:00.000Z', until: '2026-09-25T12:00:00.000Z' },
    botBills: bot === 0 ? [] : [{ orderNo: 'L260925-013', version: 2, source: 'line', soldAt: null, totalSatang: bot, createdByName: null }],
  }, { zNo: 2, grandTotalSatang: 0 })
}
const bill: ZPosBill = { posOrderId: O1, receiptNo: 'A-000312', paymentCode: 'cash', totalSatang: 10_000, soldAt: '2026-09-25T03:00:00.000Z', voidedAt: null }

describe('shift_close (spec 04 §4.10 z_report · R-m2)', () => {
  it('carries the components in baht, the chain and every list', () => {
    const { snapshot, hash } = z(10_000)
    const d = buildShiftCloseRowData({ snapshot, hash, prevHash: 'cd'.repeat(32), countId: C1, posBills: [bill], movementIds: [M1] })
    const parsed = ShiftCloseRowData.parse(d)
    expect(parsed).toMatchObject({ shift_id: S, count_id: C1, closed_by: U, closed_at: '2026-09-25T12:05:00.000Z', variance_reason: null })
    expect(parsed.z_report).toEqual({
      z_no: 3, hash, prev_hash: 'cd'.repeat(32), variance_alert: 20, chain_warning: false,
      cash: { opening_float: 500, pos_cash_sales: 100, void_refunds: 0, paid_in: 0, paid_out: 0, drops: 0, drawer_expenses: 0, bot_cash: 35 },
      counted: 635, bot_window: { after: '2026-09-24T17:00:00.000Z', until: '2026-09-25T12:00:00.000Z' }, movement_ids: [M1],
      bot_bills: [{ order_no: 'L260925-013', version: 2, total: 35 }],
      pos_bills: [{ pos_order_id: O1, receipt_no: 'A-000312', payment: 'cash', total: 100, sold_at: '2026-09-25T03:00:00.000Z', voided_at: null }],
    })
  })
  it('refuses pos_bills whose cash does not equal the Z cash sales', () => {
    const { snapshot, hash } = z(10_000)
    expect(() => buildShiftCloseRowData({ snapshot, hash, prevHash: null, countId: C1, posBills: [{ ...bill, paymentCode: 'qr' }], movementIds: [] })).toThrow(/pos_bills/)
  })
  it('refuses a bill sold after the count, and a local-only Z', () => {
    const { snapshot, hash } = z(10_000)
    expect(() => buildShiftCloseRowData({ snapshot, hash, prevHash: null, countId: C1, posBills: [{ ...bill, soldAt: '2026-09-25T12:00:00.001Z' }], movementIds: [] })).toThrow(/countedAt/)
    expect(() => buildShiftCloseRowData({ snapshot: { ...snapshot, botWindow: null }, hash, prevHash: null, countId: C1, posBills: [bill], movementIds: [] })).toThrow(/window/)
  })
  it('refuses more than 2000 POS bills (ruling R20)', () => {
    const { snapshot, hash } = z(10_000)
    const many = Array.from({ length: 2001 }, () => ({ ...bill, paymentCode: 'qr' }))
    expect(() => buildShiftCloseRowData({ snapshot, hash, prevHash: null, countId: C1, posBills: [...many, bill], movementIds: [] })).toThrow(ZTooLargeError)
  })
})

describe('shift_close — guards at the wire boundary (Task 2 security lows a/b)', () => {
  const O2 = '0b6c1e2a-4f3d-4c1b-9a8e-7d6c5b4a3f22'
  it('MAX_Z_BOT_BILLS is the one cap of shift.ts (dayo 0066 bot_bills ≤ 500)', () => {
    expect(MAX_Z_BOT_BILLS).toBe(MAX_BOT_BILLS)
  })
  it('the too-large error names what and starts Z_TOO_LARGE:', () => {
    const { snapshot, hash } = z(10_000)
    const movementIds = Array.from({ length: 501 }, (_, i) => `6b6b6b6b-0000-4000-8000-${String(i).padStart(12, '0')}`)
    const err = (() => { try { buildShiftCloseRowData({ snapshot, hash, prevHash: null, countId: C1, posBills: [bill], movementIds }) } catch (e) { return e } })()
    expect(err).toBeInstanceOf(ZTooLargeError)
    expect(err).toBeInstanceOf(RangeError)
    expect((err as Error).message).toMatch(/^Z_TOO_LARGE: movement_ids 501 > 500$/)
  })
  it('exactly 2000 POS bills and 500 movements still build and parse', () => {
    const { snapshot, hash } = z(10_000)
    const pos = Array.from({ length: 1999 }, (_, i) => ({ ...bill, posOrderId: `0b6c1e2a-4f3d-4c1b-9a8e-${String(i).padStart(12, '0')}`, paymentCode: 'qr' }))
    const movementIds = Array.from({ length: 500 }, (_, i) => `6b6b6b6b-0000-4000-8000-${String(i).padStart(12, '0')}`)
    const d = buildShiftCloseRowData({ snapshot, hash, prevHash: null, countId: C1, posBills: [...pos, bill], movementIds })
    expect(ShiftCloseRowData.safeParse(d).success).toBe(true)
  })
  it('refuses a duplicate POS bill or movement id (dayo 0066:410-414, 448 — INVALID forever)', () => {
    const { snapshot, hash } = z(10_000)
    expect(() => buildShiftCloseRowData({ snapshot, hash, prevHash: null, countId: C1, posBills: [bill, { ...bill, paymentCode: 'qr' }], movementIds: [] })).toThrow(/twice/)
    expect(() => buildShiftCloseRowData({ snapshot, hash, prevHash: null, countId: C1, posBills: [bill], movementIds: [M1, M1] })).toThrow(/twice/)
  })
  it('refuses a hash that is not the hash of this snapshot, and a malformed prev_hash', () => {
    const { snapshot, hash } = z(10_000)
    expect(() => buildShiftCloseRowData({ snapshot, hash: 'ab'.repeat(32), prevHash: null, countId: C1, posBills: [bill], movementIds: [] })).toThrow(/hash/)
    expect(() => buildShiftCloseRowData({ snapshot, hash, prevHash: 'AB'.repeat(32), countId: C1, posBills: [bill], movementIds: [] })).toThrow(/prevHash/)
  })
  it('refuses drawer expenses (block 3: always 0 — dayo 0066:398-400)', () => {
    const { snapshot } = z(10_000)
    const bad = { ...snapshot, cash: { ...snapshot.cash, drawerExpensesSatang: 100 } }
    expect(() => buildShiftCloseRowData({ snapshot: bad, hash: zReportHash(bad), prevHash: null, countId: C1, posBills: [bill], movementIds: [] })).toThrow(/drawer/)
  })
  it('refuses a variance reason longer than dayo takes (Text200 — INVALID forever)', () => {
    const { snapshot } = z(10_000)
    const long = { ...snapshot, varianceReason: 'ก'.repeat(201) }
    expect(() => buildShiftCloseRowData({ snapshot: long, hash: zReportHash(long), prevHash: null, countId: C1, posBills: [bill], movementIds: [] })).toThrow(/varianceReason/)
    const ok = { ...snapshot, varianceReason: 'ก'.repeat(200) }
    expect(ShiftCloseRowData.parse(buildShiftCloseRowData({ snapshot: ok, hash: zReportHash(ok), prevHash: null, countId: C1, posBills: [bill], movementIds: [] })).variance_reason).toHaveLength(200)
  })
  it('(a) bot cash over the numeric(10,2) cap never crosses: the edge converter throws', () => {
    const { snapshot } = z(10_000)
    const huge = EDGE_MAX_SATANG + 1
    const s2 = { ...snapshot, cash: { ...snapshot.cash, botCashSatang: huge }, botBills: [{ ...snapshot.botBills[0]!, totalSatang: huge }] }
    expect(() => buildShiftCloseRowData({ snapshot: s2, hash: zReportHash(s2), prevHash: null, countId: C1, posBills: [bill], movementIds: [] })).toThrow(MoneyEdgeError)
  })
  it('(b) stray properties anywhere in the snapshot or the bills never reach the row', () => {
    const { snapshot, hash } = z(10_000)
    const stray = {
      ...snapshot, secret: 'x',
      cash: { ...snapshot.cash, costSatang: 1 },
      botWindow: { ...snapshot.botWindow!, extra: 1 },
      botBills: snapshot.botBills.map((b) => ({ ...b, phone: '0812345678' })),
    } as unknown as typeof snapshot
    const d = buildShiftCloseRowData({ snapshot: stray, hash: zReportHash(stray), prevHash: null, countId: C1, posBills: [{ ...bill, cost: 5 } as ZPosBill], movementIds: [] })
    expect(ShiftCloseRowData.parse(d)).toEqual(d) // strict schema: any unknown key would fail here
    expect(JSON.stringify(d)).not.toMatch(/secret|costSatang|extra|phone|cost/)
  })
  it('sends every instant in the one form the contract takes (…mmmZ), the same instant', () => {
    const base = z(10_000).snapshot
    const snap = { ...base, botWindow: { after: '2026-09-24T17:00:00.000+00:00', until: base.botWindow!.until } }
    const d = buildShiftCloseRowData({ snapshot: snap, hash: zReportHash(snap), prevHash: null, countId: C1, posBills: [{ ...bill, soldAt: '2026-09-25T03:00:00Z', voidedAt: '2026-09-25T04:00:00.5Z' }], movementIds: [] })
    expect(d.z_report.bot_window.after).toBe('2026-09-24T17:00:00.000Z')
    expect(d.z_report.pos_bills[0]).toMatchObject({ sold_at: '2026-09-25T03:00:00.000Z', voided_at: '2026-09-25T04:00:00.500Z' })
    expect(ShiftCloseRowData.safeParse(d).success).toBe(true)
  })
  it('refuses a bill time that is not an ISO UTC instant', () => {
    const { snapshot, hash } = z(10_000)
    expect(() => buildShiftCloseRowData({ snapshot, hash, prevHash: null, countId: C1, posBills: [{ ...bill, soldAt: '2026-09-25 03:00' }], movementIds: [] })).toThrow(/soldAt/)
    expect(() => buildShiftCloseRowData({ snapshot, hash, prevHash: null, countId: C1, posBills: [{ ...bill, voidedAt: 'yesterday' }], movementIds: [] })).toThrow(/voidedAt/)
  })
  it('a voided cash bill still counts as cash sales (the refund is its own VOID_REFUND movement)', () => {
    const { snapshot, hash } = z(10_000)
    const d = buildShiftCloseRowData({ snapshot, hash, prevHash: null, countId: C1, posBills: [{ ...bill, voidedAt: '2026-09-25T05:00:00.000Z' }, { ...bill, posOrderId: O2, receiptNo: 'A-000313', paymentCode: 'qr', totalSatang: 5_000 }], movementIds: [] })
    expect(d.z_report.pos_bills).toHaveLength(2)
  })
})

describe('shift rows — Task 3 fix round 1 item 3: every builder parses its own row', () => {
  const at = '2026-09-25T03:00:00.000Z'
  it('shift_open: a non-uuid id fails at build time', () => {
    expect(() => buildShiftOpenRowData({ shiftId: 'x', businessDate: '2026-09-25', openedAt: '2026-09-25T02:00:00.000Z', openedBy: U, openingFloatSatang: 0, quickOpen: false })).toThrow(/shift_id/)
  })
  it('cash_movement: a reason with a control character or a lone surrogate is refused (dayo_pos_is_text)', () => {
    const mv = { movementId: M1, shiftId: S, kind: 'PAID_IN' as const, amountSatang: 100, posOrderId: null, createdBy: U, createdAt: at }
    expect(() => buildCashMovementRowData({ ...mv, reason: 'a\u0000b' })).toThrow(/reason/)
    expect(() => buildCashMovementRowData({ ...mv, reason: 'a\ud83c' })).toThrow(/reason/)
    expect(() => buildCashMovementRowData({ ...mv, reason: 'ok', createdBy: 'nobody' })).toThrow(/created_by/)
  })
  it('cash_count: a non-uuid counter fails at build time', () => {
    expect(() => buildCashCountRowData({ countId: C1, shiftId: S, lines: [], countedBy: 'nobody', countedAt: '2026-09-25T12:00:00.000Z' })).toThrow(/counted_by/)
  })
  it('shift_close: a variance reason with a control character, or a non-uuid count id, fails at build time', () => {
    const { snapshot } = z(10_000)
    const bad = { ...snapshot, varianceReason: 'short\u0007' }
    expect(() => buildShiftCloseRowData({ snapshot: bad, hash: zReportHash(bad), prevHash: null, countId: C1, posBills: [bill], movementIds: [] })).toThrow(/varianceReason/)
    const { snapshot: s2, hash } = z(10_000)
    expect(() => buildShiftCloseRowData({ snapshot: s2, hash, prevHash: null, countId: 'nope', posBills: [bill], movementIds: [] })).toThrow(/count_id/)
  })
})
