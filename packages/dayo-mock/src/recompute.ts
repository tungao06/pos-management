// packages/dayo-mock/src/recompute.ts — dayo's recompute of a Z (spec 04 §4.10 การคิดใบปิดกะซ้ำ rules 1–7 · R3-A), enough for
// the tablet's tests. dayo ADR-0069 PHASE 2 — dayo main 12885fe leaves recompute_status null, so a phase-1 mock never runs this
// (preflight P1/P3). One key only: "another key's bill/shift" (S4) cannot happen here. No node:* imports.
// Not modelled: the audit_log "changed after the count" note of a bot bill (R3-m2 — any total change is a difference here) and
// the receipt_no ≠ external_ref note (R-I2 — the mock never renumbers a stored bill).
import { chainOf } from './judge-shift.js'
import { cents } from './judge-util.js'
import { botCashBills } from './shift-cash.js'
import type { MockState, MockZ } from './state.js'

type Wire = {
  cash: Record<string, number>; counted: number; bot_window: { after: string; until: string }; movement_ids: string[]
  bot_bills: { order_no: string; total: number }[]
  pos_bills: { pos_order_id: string; receipt_no: string; payment: string; total: number; sold_at: string; voided_at: string | null }[]
}

/** spec §4.10 (R3-A): row checks always · sums only when nothing is missing · a difference → mismatch · missing → waiting_bills · else matched. */
export function recompute(s: MockState, z: MockZ): void {
  const w = z.wire as unknown as Wire
  const shift = s.shifts.get(z.shiftId)!
  const until = z.countedAt
  const diff: string[] = [...z.chainMismatch]
  const missing = { posOrderIds: [] as string[], movementIds: [] as string[], voidOrderIds: [] as string[] }
  let posCash = 0
  for (const b of w.pos_bills) {                                                                        // rules 1–2
    const o = s.orders.get(b.pos_order_id)
    if (o === undefined) { missing.posOrderIds.push(b.pos_order_id); continue }
    if (o.data?.shift_id !== z.shiftId) diff.push(`บิล ${b.receipt_no} ไม่ได้อยู่ในกะนี้`)
    if (cents(o.total) !== cents(b.total)) diff.push(`ยอดบิล ${b.receipt_no} ต่าง`)                 // the reported (frozen) total — D93
    if (Date.parse(o.soldAt) !== Date.parse(b.sold_at)) diff.push(`เวลาขาย ${b.receipt_no} ต่าง`)
    const payment = o.data?.payment ?? ''
    if ((payment === 'cash') !== (b.payment === 'cash')) diff.push(`วิธีชำระ ${b.receipt_no} คนละฝั่งเงินสด`) // R-I2: only the cash side counts
    if (payment === 'cash' && Date.parse(o.soldAt) <= until) posCash += cents(o.total)
  }
  for (const o of s.orders.values()) {                                                                  // rule 3
    if (o.data?.shift_id === z.shiftId && !w.pos_bills.some((b) => b.pos_order_id === o.posOrderId)) diff.push(`บิล ${o.receiptNo} ของกะนี้ไม่อยู่ใน Z`)
  }
  const sums = { VOID_REFUND: 0, PAID_IN: 0, PAID_OUT: 0, DROP: 0 }
  for (const id of w.movement_ids) {
    const m = s.movements.get(id)
    if (m === undefined) { missing.movementIds.push(id); continue }
    if (m.shiftId !== z.shiftId || m.createdAt > until) { diff.push(`เงินเข้า-ออก ${id} ไม่ใช่ของกะนี้`); continue }
    sums[m.kind] += cents(m.amount)
    if (m.kind === 'VOID_REFUND') {                                                                     // R3-m9
      const orderId = m.posOrderId!
      const inZ = w.pos_bills.find((b) => b.pos_order_id === orderId)
      const o = s.orders.get(orderId)
      if (inZ !== undefined && inZ.voided_at === null) diff.push('เงินคืนของบิลที่ Z เดียวกันบอกว่ายังไม่ยกเลิก')
      else if (o === undefined || o.status !== 'cancelled') { if (!missing.voidOrderIds.includes(orderId)) missing.voidOrderIds.push(orderId) }
      else if ([...s.movements.values()].filter((x) => x.kind === 'VOID_REFUND' && x.posOrderId === orderId).reduce((a, x) => a + cents(x.amount), 0) > cents(o.total)) {
        const text = `เงินคืนของบิล ${o.receiptNo} เกินยอดบิล`                                           // Σ VOID_REFUND per bill (every shift) ≤ its reported total
        if (!diff.includes(text)) diff.push(text)
      }
    }
  }
  for (const m of s.movements.values()) {
    if (m.shiftId === z.shiftId && m.createdAt <= until && !w.movement_ids.includes(m.id)) diff.push(`เงินเข้า-ออก ${m.id} ไม่อยู่ใน Z`)
  }
  const found = botCashBills(s, Date.parse(w.bot_window.after), Date.parse(w.bot_window.until))          // rule 4 (dayo runs E4's query itself — S2)
  const names = (xs: { order_no: string }[]): string => JSON.stringify(xs.map((b) => b.order_no).sort())
  if (names(found) !== names(w.bot_bills)) diff.push('ชุดบิลบอทไม่ตรง')
  // spec 04 §4.10 การคิดซ้ำ ข้อ 4 "order_no แต่ละใบต้องไม่อยู่ใน Z อื่น": read literally, so a bot bill listed by two Zs makes BOTH
  // mismatch (the spec does not say which Z counted it first) — noted for dayo (Task 8 fix round 1).
  const otherZs = [...s.zReports.values()].filter((x) => x.shiftId !== z.shiftId && !x.quarantined)     // a quarantined Z is nobody's reference (R5-3)
  for (const b of w.bot_bills) {
    const f = found.find((x) => x.order_no === b.order_no)
    if (f !== undefined && cents(f.total) !== cents(b.total)) diff.push(`ยอดบิลบอท ${b.order_no} ต่าง`)
    if (otherZs.some((x) => (x.wire as unknown as Wire).bot_bills.some((y) => y.order_no === b.order_no))) diff.push(`บิลบอท ${b.order_no} อยู่ใน Z อื่นแล้ว`)
  }
  const isMissing = missing.posOrderIds.length + missing.movementIds.length + missing.voidOrderIds.length > 0
  if (!isMissing && diff.length === 0) {                                                                // rule 5
    const want: Record<string, number> = {
      opening_float: cents(shift.openingFloat), pos_cash_sales: posCash, void_refunds: sums.VOID_REFUND, paid_in: sums.PAID_IN, paid_out: sums.PAID_OUT,
      drops: sums.DROP, drawer_expenses: 0, bot_cash: w.bot_bills.reduce((a, b) => a + cents(b.total), 0),
    }
    for (const [k, v] of Object.entries(want)) if (cents(w.cash[k]!) !== v) diff.push(`องค์ประกอบ ${k} ต่าง`)
  }
  z.detail = diff
  z.missing = missing
  z.recomputeStatus = diff.length > 0 ? 'mismatch' : isMissing ? 'waiting_bills' : 'matched'
}

/**
 * Rule 6: every Z is judged again, oldest number first — the chain (rules 2–4; the R5-3 quarantine set at receipt is only
 * read), then the money. The mock is small, so it re-judges every Z instead of only the touched shift and z_no + 1.
 * A phase-1 mock (dayo main 12885fe) has no recompute: this does nothing there.
 */
export function recomputeAll(s: MockState): void {
  if (!s.block3Phase2) return
  for (const z of [...s.zReports.values()].sort((a, b) => a.zNo - b.zNo)) {
    Object.assign(z, chainOf(s, z))
    recompute(s, z)
  }
}

/** Back to what dayo phase 1 stores (the mock left phase 2): chain_break kept, no phase-2 diagnostics, recompute_status null. */
export function clearRecompute(s: MockState): void {
  for (const z of s.zReports.values()) {
    Object.assign(z, { notes: [], chainMismatch: [], recomputeStatus: null, detail: [], missing: { posOrderIds: [], movementIds: [], voidOrderIds: [] } })
  }
}
