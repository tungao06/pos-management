import type { OrderRowData } from '@dayo/contracts'
import { edgeBahtToSatang, edgeSatangToBaht } from './money-edge.js'
import { CartError, type BillDiscountDraft, type CartDraft, type CartLineDraft, type PricedCart } from './price-cart.js'

export type OrderRowInput = { posOrderId: string; receiptNo: string; queueNo: number; staffId: string; catalogVersion: number; shiftId: string | null; cart: CartDraft; priced: PricedCart; note: string | null }

/** The size goes as is: priceCart already refused any size that is not an active size of catalog.sizes (ADR-0054). */
function lineToRow(l: CartLineDraft): OrderRowData['lines'][number] {
  return {
    code: l.code, size: l.size, sweetness: l.sweetness, milk: l.milk, grade: l.grade, qty: l.qty,
    ...(l.free ? { free: true } : {}),
    ...(l.discountSatang !== null ? { discount_baht: edgeSatangToBaht(l.discountSatang) } : {}),
    ...(l.discountPercent !== null ? { discount_percent: l.discountPercent } : {}),
    ...(l.discountReason !== null ? { discount_reason: l.discountReason } : {}),
  }
}

function billToRow(d: BillDiscountDraft | null): OrderRowData['bill_discount'] {
  if (d === null) return null
  return d.kind === 'satang' ? { baht: edgeSatangToBaht(d.satang), reason: d.reason } : { percent: d.percent, reason: d.reason }
}

/** `data` of an E2 row of kind `order` (spec 04 §4.5) — money converted once, here, at write time (spec §6.1). */
export function buildOrderRowData(i: OrderRowInput): OrderRowData {
  const p = i.priced
  return {
    pos_order_id: i.posOrderId,
    receipt_no: i.receiptNo,
    queue_no: i.queueNo,
    sale_date: p.saleDate,
    sold_at: p.soldAt,
    channel: i.cart.channelCode,
    payment: i.cart.paymentCode,
    staff_id: i.staffId,
    catalog_version: i.catalogVersion,
    shift_id: i.shiftId, // block 3: the shift id of a central shift, null for a local-only one (spec §4.5 shift_id · §4.10 ข้อ 4)
    lines: i.cart.lines.map(lineToRow),
    bill_discount: billToRow(i.cart.billDiscount),
    promo_code: i.cart.promoCode,
    skip_promotion_ids: i.cart.noPromotions ? [] : [...i.cart.skipPromotionIds],
    no_promotions: i.cart.noPromotions,
    totals: {
      items_subtotal: edgeSatangToBaht(p.itemsSubtotalSatang),
      items_discount: edgeSatangToBaht(p.itemsDiscountSatang),
      bill_discount: edgeSatangToBaht(p.billDiscountSatang),
      total: edgeSatangToBaht(p.totalSatang),
    },
    note: i.note,
  }
}

/** A queued E2 row → the cart it describes (the inverse of buildOrderRowData; owner remedies and tests use it). */
export function orderRowToCart(draft: OrderRowData): { cart: CartDraft; soldAt: string } {
  const b = draft.bill_discount ?? null
  const baht = b?.baht ?? null
  const percent = b?.percent ?? null
  if (baht !== null && percent !== null) throw new CartError('BAD_DISCOUNT', 'bill_discount has both baht and percent') // spec §5.3 case 15
  const billDiscount: BillDiscountDraft | null =
    baht !== null ? { kind: 'satang', satang: edgeBahtToSatang(baht), reason: b?.reason ?? null }
    : percent !== null ? { kind: 'percent', percent, reason: b?.reason ?? null }
    : null
  return {
    soldAt: draft.sold_at,
    cart: {
      channelCode: draft.channel,
      paymentCode: draft.payment,
      lines: draft.lines.map((l) => ({
        code: l.code, size: l.size, sweetness: l.sweetness, milk: l.milk, grade: l.grade, qty: l.qty,
        free: l.free ?? false,
        discountSatang: l.discount_baht === undefined || l.discount_baht === null ? null : edgeBahtToSatang(l.discount_baht),
        discountPercent: l.discount_percent ?? null,
        discountReason: l.discount_reason ?? null,
      })),
      billDiscount,
      promoCode: draft.promo_code ?? null,
      skipPromotionIds: draft.no_promotions ? [] : [...(draft.skip_promotion_ids ?? [])],
      noPromotions: draft.no_promotions ?? false,
    },
  }
}
