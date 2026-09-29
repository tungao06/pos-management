import { bangkokDateOf, clipCodePoints, isPosText, OrderOffCatalogRowData, TEXT_MAX_CODE_POINTS, type OrderRowData } from '@dayo/contracts'
import { edgeBahtToSatang, edgeSatangToBaht as b } from './money-edge.js'
import { toSentIso } from './shift.js'

/** One line of the bill as the tablet froze it (order_line): money in satang, never re-priced. */
export type OffCatalogItem = { menuCode: string; menuNameTh: string; size: string | null; sweetness: string | null; qty: number; unitPriceSatang: number; discountPerCupSatang: number; lineTotalSatang: number }
export type OffCatalogInput = { order: OrderRowData; items: readonly OffCatalogItem[]; closedBy: string; closedAt: string; reason: string; originalReason: string }
export type OffCatalogErrorCode = 'UNREPRESENTABLE' | 'BAD_REASON'

export class OffCatalogError extends Error {
  readonly code: OffCatalogErrorCode
  constructor(code: OffCatalogErrorCode, detail: string) {
    super(`${code}: ${detail}`)
    this.name = 'OffCatalogError'
    this.code = code
  }
}

/** contracts OrderOffCatalogRowData: lines 1–50, qty 1–999, code ≤ 40, name ≤ 100, size ≤ 20, sweetness ≤ 10 code points. */
const MAX_LINES = 50
const MAX_QTY = 999
const ORIGINAL_REASON_RE = /^[A-Z_]{1,40}$/

/** dayo text (contracts isPosText: code points, no control, well-formed) and not blank after any trim — else null.
 * dayo refuses '' for size/sweetness, so an empty, malformed or too-long optional text goes as null (review item 2). */
const textOrNull = (v: string | null, max: number): string | null => (v !== null && isPosText(v, max) && v.trim() !== '' ? v : null)

const wholeSatang = (n: number): boolean => Number.isSafeInteger(n) && n >= 0

/**
 * D91 · D97 · spec §4.10 order_off_catalog: the bill as the tablet froze it — never new money. Ruling R10: a line keeps
 * its per-cup discount only when (unit − dpc) × qty is exactly its frozen total; otherwise the line goes at full price
 * and the difference joins the bill discount. items_subtotal and total are always the frozen ones: lines that do not
 * hold the order row's cups, do not add up to the frozen subtotal, or cannot reach the frozen total without a negative
 * discount, are refused. The row is parsed by its contract schema before it is returned (fix round 1 item 3).
 */
export function buildOffCatalogRowData(i: OffCatalogInput): OrderOffCatalogRowData {
  if (typeof i.originalReason !== 'string' || !ORIGINAL_REASON_RE.test(i.originalReason)) throw new OffCatalogError('BAD_REASON', `original reason ${JSON.stringify(i.originalReason)}`)
  if (typeof i.reason !== 'string' || textOrNull(i.reason, TEXT_MAX_CODE_POINTS) === null) {
    throw new OffCatalogError('BAD_REASON', `reason must be 1–${TEXT_MAX_CODE_POINTS} code points, no control characters, not blank`)
  }
  if (i.items.length < 1 || i.items.length > MAX_LINES) throw new OffCatalogError('UNREPRESENTABLE', `${i.items.length} lines (1–${MAX_LINES})`)
  const o = i.order
  const frozenSubtotal = edgeBahtToSatang(o.totals.items_subtotal)
  const total = edgeBahtToSatang(o.totals.total)
  let sub = 0
  let idisc = 0
  let cups = 0
  const lines = i.items.map((it, n) => {
    if (!Number.isSafeInteger(it.qty) || it.qty < 1 || it.qty > MAX_QTY) throw new OffCatalogError('UNREPRESENTABLE', `line ${n + 1}: qty ${it.qty} (1–${MAX_QTY})`)
    if (!wholeSatang(it.unitPriceSatang) || !wholeSatang(it.discountPerCupSatang) || !wholeSatang(it.lineTotalSatang)) {
      throw new OffCatalogError('UNREPRESENTABLE', `line ${n + 1}: money must be whole satang ≥ 0`)
    }
    const exact = it.discountPerCupSatang <= it.unitPriceSatang && (it.unitPriceSatang - it.discountPerCupSatang) * it.qty === it.lineTotalSatang
    const dpc = exact ? it.discountPerCupSatang : 0
    sub += it.unitPriceSatang * it.qty
    idisc += dpc * it.qty
    cups += it.qty
    if (!Number.isSafeInteger(sub)) throw new OffCatalogError('UNREPRESENTABLE', 'items subtotal out of range')
    // the Thai name, else the code (an empty or malformed name falls back), clipped to 100 code points — never half a pair
    const name = [it.menuNameTh, it.menuCode].map((v) => clipCodePoints(v, 100)).find((v) => textOrNull(v, 100) !== null)
    if (name === undefined) throw new OffCatalogError('UNREPRESENTABLE', `line ${n + 1}: no usable name or code`)
    // explicit fields only: nothing else an item carries reaches dayo
    return {
      code: textOrNull(it.menuCode, 40), name, size: textOrNull(it.size, 20), sweetness: textOrNull(it.sweetness, 10), qty: it.qty,
      unit_price: b(it.unitPriceSatang), discount_per_cup: b(dpc), line_total: b((it.unitPriceSatang - dpc) * it.qty),
    }
  })
  // fix round 1 item 5: the same cups as the order row. Total only — not per code: the owner's REMAP_CODE rewrites
  // order.lines[].code in the queued row while the frozen local lines keep the code the bill was sold with.
  const orderCups = o.lines.reduce((a, l) => a + l.qty, 0)
  if (cups !== orderCups) throw new OffCatalogError('UNREPRESENTABLE', `lines hold ${cups} cups, the order row ${orderCups}`)
  if (sub !== frozenSubtotal) throw new OffCatalogError('UNREPRESENTABLE', `lines add up to ${sub}, the bill's subtotal was ${frozenSubtotal}`)
  const bdisc = sub - idisc - total
  if (bdisc < 0) throw new OffCatalogError('UNREPRESENTABLE', `lines give ${sub - idisc}, the bill took ${total}`)
  return OrderOffCatalogRowData.parse({
    pos_order_id: o.pos_order_id, receipt_no: o.receipt_no, queue_no: o.queue_no, sale_date: bangkokDateOf(o.sold_at), sold_at: o.sold_at,
    channel: o.channel, payment: o.payment, staff_id: o.staff_id, catalog_version: o.catalog_version, shift_id: o.shift_id, note: o.note,
    lines, totals: { items_subtotal: b(sub), items_discount: b(idisc), bill_discount: b(bdisc), total: b(total) },
    closed_by: i.closedBy, closed_at: toSentIso(i.closedAt, 'closedAt'), reason: i.reason, original_reason: i.originalReason,
  })
}
