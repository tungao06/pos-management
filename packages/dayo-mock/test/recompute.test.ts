// dayo's recompute of a Z (spec 04 §4.10 การคิดใบปิดกะซ้ำ rules 1–7 · R3-A) — dayo ADR-0069 PHASE 2, so these run on a
// `block3Phase2` mock (preflight P3/D2). dayo main 12885fe (phase 1) keeps recompute_status null: the last block pins that.
import { describe, expect, it } from 'vitest'
import { at, botBill, cashCount, cid, emptyZ, H, mid, movementRow, newMock, newMockPhase1, oid, orderRow, posBill, push, row, shiftClose, shiftOpen, sid, voidRow } from './helpers-block3'

const z1 = (mock: ReturnType<typeof newMock>) => mock.zReports().find((z) => z.shiftId === sid(1))!
const zNo = (mock: ReturnType<typeof newMock>, n: number) => mock.zReports().find((z) => z.zNo === n)!
const openAndCount = (counted: number) => [row('shift_open', sid(1), shiftOpen(1)), row('cash_count', cid(1), cashCount(1, at(5), counted))]
const bot70 = { order_no: 'L260925-901', version: 1, total: 70 }

describe('recompute of a Z (spec 04 §4.10 การคิดซ้ำ · R3-A order: row checks always, sums only when nothing is missing)', () => {
  it('every row present and the sums agree → matched', async () => {
    const mock = newMock()
    mock.seedCentralOrders([botBill('L260925-901', 70, '2026-09-25T04:00:00+00:00')])
    await push(mock, [...openAndCount(605), row('order', oid(1), orderRow(1, { shiftId: sid(1) })),
      row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(5), counted: 605, cash: { pos_cash_sales: 35 }, posBills: [posBill(1)], botBills: [bot70] }))])
    expect(z1(mock)).toMatchObject({ recomputeStatus: 'matched', detail: [] })
  })
  it('the Z before its bill → waiting_bills; the bill arrives → matched with nothing more sent (§9)', async () => {
    const mock = newMock()
    await push(mock, [...openAndCount(535), row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(5), counted: 535, cash: { pos_cash_sales: 35 }, posBills: [posBill(1)] }))])
    expect(z1(mock)).toMatchObject({ recomputeStatus: 'waiting_bills', missing: { posOrderIds: [oid(1)], movementIds: [], voidOrderIds: [] } })
    await push(mock, [row('order', oid(1), orderRow(1, { shiftId: sid(1) }))])
    expect(z1(mock)).toMatchObject({ recomputeStatus: 'matched', missing: { posOrderIds: [] } })
  })
  it('R3-A: a bill that is there but different makes mismatch at once, even while another bill is still missing', async () => {
    const mock = newMock()
    await push(mock, [...openAndCount(535), row('order', oid(1), orderRow(1, { shiftId: sid(1), total: 40 })),
      row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(5), counted: 535, cash: { pos_cash_sales: 35 }, posBills: [posBill(1), posBill(2, { payment: 'qr' })] }))])
    expect(z1(mock).recomputeStatus).toBe('mismatch')
    expect(z1(mock).detail).toContain('ยอดบิล A-000001 ต่าง')
    expect(z1(mock).missing.posOrderIds).toEqual([oid(2)])
  })
  it('a movement id of the Z that belongs to another shift → mismatch', async () => {
    const mock = newMock()
    await push(mock, [row('shift_open', sid(2), shiftOpen(2)), row('cash_movement', mid(1), movementRow(1, 2, 'PAID_OUT', 20, at(2))),
      ...openAndCount(480), row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(5), counted: 480, cash: { paid_out: 20 }, movementIds: [mid(1)] }))])
    expect(z1(mock).recomputeStatus).toBe('mismatch')
    expect(z1(mock).detail).toContain(`เงินเข้า-ออก ${mid(1)} ไม่ใช่ของกะนี้`)
  })
  it('VOID_REFUND of a bill the same Z says is not voided → mismatch (R3-m9)', async () => {
    const mock = newMock()
    await push(mock, [...openAndCount(500), row('order', oid(1), orderRow(1, { shiftId: sid(1) })), row('cash_movement', mid(1), movementRow(1, 1, 'VOID_REFUND', 35, at(2), 1)),
      row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(5), counted: 500, cash: { pos_cash_sales: 35, void_refunds: 35 }, posBills: [posBill(1, { voidedAt: null })], movementIds: [mid(1)] }))])
    expect(z1(mock).recomputeStatus).toBe('mismatch')
    expect(z1(mock).detail).toContain('เงินคืนของบิลที่ Z เดียวกันบอกว่ายังไม่ยกเลิก')
  })
  it('VOID_REFUND waiting for its order_void → waiting_bills (missing void); the void arrives → matched', async () => {
    const mock = newMock()
    await push(mock, [...openAndCount(500), row('order', oid(1), orderRow(1, { shiftId: sid(1) })), row('cash_movement', mid(1), movementRow(1, 1, 'VOID_REFUND', 35, at(2), 1)),
      row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(5), counted: 500, cash: { pos_cash_sales: 35, void_refunds: 35 }, posBills: [posBill(1, { voidedAt: at(2) })], movementIds: [mid(1)] }))])
    expect(z1(mock)).toMatchObject({ recomputeStatus: 'waiting_bills', missing: { voidOrderIds: [oid(1)] } })
    await push(mock, [row('order_void', oid(1), voidRow(1, at(2)))])
    expect(z1(mock)).toMatchObject({ recomputeStatus: 'matched', missing: { voidOrderIds: [] } })
  })
  it('the owner cancelling that bill on the web also ends the wait (rule 6 · R3-m1)', async () => {
    const mock = newMock()
    await push(mock, [...openAndCount(500), row('order', oid(1), orderRow(1, { shiftId: sid(1) })), row('cash_movement', mid(1), movementRow(1, 1, 'VOID_REFUND', 35, at(2), 1)),
      row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(5), counted: 500, cash: { pos_cash_sales: 35, void_refunds: 35 }, posBills: [posBill(1, { voidedAt: at(2) })], movementIds: [mid(1)] }))])
    mock.editPosOrder(oid(1), { kind: 'cancel', reason: 'ลูกค้ายกเลิก' })
    expect(z1(mock)).toMatchObject({ recomputeStatus: 'matched', missing: { voidOrderIds: [] } })
  })
  it('Σ VOID_REFUND of one bill above its reported total → mismatch (rule 3)', async () => {
    const mock = newMock()
    await push(mock, [...openAndCount(465), row('order', oid(1), orderRow(1, { shiftId: sid(1) })), row('order_void', oid(1), voidRow(1, at(2))),
      row('cash_movement', mid(1), movementRow(1, 1, 'VOID_REFUND', 35, at(2), 1)), row('cash_movement', mid(2), movementRow(2, 1, 'VOID_REFUND', 35, at(3), 1)),
      row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(5), counted: 465, cash: { pos_cash_sales: 35, void_refunds: 70 }, posBills: [posBill(1, { voidedAt: at(2) })], movementIds: [mid(1), mid(2)] }))])
    expect(z1(mock).recomputeStatus).toBe('mismatch')
    expect(z1(mock).detail).toEqual(['เงินคืนของบิล A-000001 เกินยอดบิล'])
  })
  it('a bot bill dayo finds in the window that the Z does not list → mismatch (S2)', async () => {
    const mock = newMock()
    mock.seedCentralOrders([botBill('L260925-901', 70, '2026-09-25T04:00:00+00:00')])
    await push(mock, [...openAndCount(500), row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(5), counted: 500 }))])
    expect(z1(mock).detail).toContain('ชุดบิลบอทไม่ตรง')
  })
  it('a bot bill already counted in another Z → mismatch (rule 4: every bot bill is counted once)', async () => {
    const mock = newMock()
    mock.seedCentralOrders([botBill('L260925-901', 70, '2026-09-25T04:00:00+00:00')])
    await push(mock, [...openAndCount(570), row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(5), counted: 570, botBills: [bot70] }))])
    expect(z1(mock).recomputeStatus).toBe('matched')
    await push(mock, [row('shift_open', sid(2), shiftOpen(2)), row('cash_count', cid(2), cashCount(2, at(6), 570)),
      row('shift_close', sid(2), shiftClose(2, { zNo: 2, countedAt: at(6), counted: 570, prevHash: H(1), after: at(3), botBills: [bot70] }))])
    expect(zNo(mock, 2).recomputeStatus).toBe('mismatch')
    expect(zNo(mock, 2).detail).toContain('บิลบอท L260925-901 อยู่ใน Z อื่นแล้ว')
  })
  it('a bot bill whose total changed since the count → mismatch (R3-m2 · the mock has no audit_log, so no "changed after count" note)', async () => {
    const mock = newMock()
    const bot = botBill('L260925-901', 70, '2026-09-25T04:00:00+00:00')
    mock.seedCentralOrders([bot])
    await push(mock, [...openAndCount(570), row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(5), counted: 570, botBills: [bot70] }))])
    expect(z1(mock).recomputeStatus).toBe('matched')
    bot.totals.total = 80                                                        // seedCentralOrders keeps the objects it is given
    mock.recomputeAll()
    expect(z1(mock)).toMatchObject({ recomputeStatus: 'mismatch', detail: ['ยอดบิลบอท L260925-901 ต่าง'] })
  })
  it('opening_float of the Z ≠ the shift row → mismatch', async () => {
    const mock = newMock()
    await push(mock, [...openAndCount(400), row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(5), counted: 400, cash: { opening_float: 400 } }))])
    expect(z1(mock).detail).toEqual(['องค์ประกอบ opening_float ต่าง'])
  })
  it('a different payment code on the same non-cash side is no difference (R-I2)', async () => {
    const mock = newMock()
    await push(mock, [...openAndCount(500), row('order', oid(1), orderRow(1, { shiftId: sid(1), payment: 'qr' })),
      row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(5), counted: 500, posBills: [posBill(1, { payment: 'promptpay' })] }))])
    expect(z1(mock)).toMatchObject({ recomputeStatus: 'matched' })
  })
  it('rule 6: when the missing Z 5 arrives, Z 6 is judged again and its gap note goes away', async () => {
    const mock = newMock()
    await emptyZ(mock, 4, 4, at(4))
    await push(mock, [row('shift_open', sid(5), shiftOpen(5)), row('cash_count', cid(5), cashCount(5, at(5), 500))])
    await emptyZ(mock, 6, 6, at(6), { prevHash: H(5), after: at(5) })
    expect(zNo(mock, 6).notes).toEqual(['Z ขาดช่วง / Z ก่อนหน้ายังไม่มี'])
    await push(mock, [row('shift_close', sid(5), shiftClose(5, { zNo: 5, countedAt: at(5), counted: 500, prevHash: H(4), after: at(4) }))])
    expect(zNo(mock, 6)).toMatchObject({ notes: [], chainBreak: false, recomputeStatus: 'matched' })
  })
  it('R5-3: a normal Z next to a quarantined one stays matched; only the quarantined Z is mismatch', async () => {
    const mock = newMock()
    await emptyZ(mock, 4, 4, at(4))
    await emptyZ(mock, 6, 6, at(6), { prevHash: H(5), after: at(5) })
    await emptyZ(mock, 5, 5, at(7), { prevHash: H(4), after: at(4) })            // replay → quarantined
    await emptyZ(mock, 7, 7, at(8), { prevHash: H(6), after: at(6) })
    expect([4, 5, 6, 7].map((n) => [n, zNo(mock, n).quarantined, zNo(mock, n).recomputeStatus])).toEqual([[4, false, 'matched'], [5, true, 'mismatch'], [6, false, 'matched'], [7, false, 'matched']])
  })
})

describe('dayo phase 1 (main 12885fe — preflight P3): no recompute', () => {
  it('recomputeStatus stays null, notes/chainMismatch/detail/missing stay empty; chain_break and quarantine are still decided at receipt', async () => {
    const mock = newMockPhase1()
    await emptyZ(mock, 4, 4, at(4))
    await emptyZ(mock, 6, 6, at(6), { prevHash: H(9), after: at(3) })           // gap (rule 4 note in phase 2) · phase 1: Z 5 missing = no chain_break
    await emptyZ(mock, 5, 5, at(7), { prevHash: H(4), after: at(4) })           // replay → quarantined
    await push(mock, [row('shift_open', sid(1), shiftOpen(1)), row('cash_count', cid(1), cashCount(1, at(9), 500)),
      row('shift_close', sid(1), shiftClose(1, { zNo: 7, countedAt: at(9), counted: 500, prevHash: H(9), after: at(1), posBills: [posBill(1)] }))])
    const clean = { notes: [], chainMismatch: [], recomputeStatus: null, detail: [], missing: { posOrderIds: [], movementIds: [], voidOrderIds: [] } }
    expect(zNo(mock, 4)).toMatchObject({ ...clean, chainBreak: false, firstOfKey: true })
    expect(zNo(mock, 5)).toMatchObject({ ...clean, chainBreak: true, quarantined: true })
    expect(zNo(mock, 6)).toMatchObject({ ...clean, chainBreak: false })
    expect(zNo(mock, 7)).toMatchObject({ ...clean, chainBreak: true })            // prev_hash ≠ Z 6's hash (0066:540-542)
    mock.recomputeAll()                                                          // a no-op on a phase-1 dayo
    expect(zNo(mock, 7)).toMatchObject(clean)
  })
  it('switching phase 2 on judges the stored Zs; switching it off again leaves dayo phase 1 values', async () => {
    const mock = newMockPhase1()
    await push(mock, [...openAndCount(535), row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(5), counted: 535, cash: { pos_cash_sales: 35 }, posBills: [posBill(1)] }))])
    expect(z1(mock).recomputeStatus).toBeNull()
    mock.setBlock3Phase2(true)
    expect(z1(mock)).toMatchObject({ recomputeStatus: 'waiting_bills', missing: { posOrderIds: [oid(1)] } })
    mock.setBlock3Phase2(false)
    expect(z1(mock)).toMatchObject({ recomputeStatus: null, missing: { posOrderIds: [] } })
  })
})
