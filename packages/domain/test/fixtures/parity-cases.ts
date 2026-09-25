import type { ParityDraft } from '@dayo/contracts'

type L = ParityDraft['lines'][number]
const tt = (o: Partial<L> = {}): L => ({ code: 'Thai Tea', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1, ...o })
const mt = (o: Partial<L> = {}): L => ({ code: 'Matcha Latte', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: 'Excellent', qty: 1, ...o })
const cc = (o: Partial<L> = {}): L => ({ code: 'Cocoa', size: '16 oz', sweetness: '50%', milk: 'fresh', grade: null, qty: 1, ...o })
const d = (lines: L[], o: Partial<ParityDraft> = {}): ParityDraft => ({ saleDate: '2026-09-25', saleTime: '10:30', channelCode: 'store', paymentCode: 'cash', lines, promoCode: null, skipPromotionIds: [], ...o })
const P = (n: number): string => `9f8e0000-0000-4000-8000-00000000000${n}`
const ALL = [1, 2, 3, 4, 5].map(P)
const SWEET = ['0%', '25%', '50%', '75%', '100%'] as const

/** spec 04 §5.3 on the POS test catalog. c11 (shop default oat) and c14 (disabled after sale) need another catalog state — only dayo's export has them. */
export const PARITY_CASES: { id: string; spec: string; draft: ParityDraft }[] = [
  { id: 'c01a-pct15-of-35', spec: '§5.3-1', draft: d([tt({ discountPercent: 15 })]) },
  { id: 'c01b-pct15-of-45', spec: '§5.3-1', draft: d([tt({ size: '20 oz', discountPercent: 15 })]) },
  { id: 'c01c-pct7-of-85', spec: '§5.3-1', draft: d([mt({ discountPercent: 7 })]) },
  { id: 'c01d-pct33-of-65', spec: '§5.3-1', draft: d([{ code: 'Pink Milk', size: '16 oz', sweetness: '100%', milk: 'fresh', grade: null, qty: 1, discountPercent: 33 }]) },
  { id: 'c02a-lineman-7pct-ceil-plus5', spec: '§5.3-2', draft: d([tt()], { channelCode: 'lineman', paymentCode: 'qr' }) },
  { id: 'c02b-grab-30pct-ceil', spec: '§5.3-2', draft: d([tt({ size: '20 oz' })], { channelCode: 'grab', paymentCode: 'qr' }) },
  { id: 'c03-grab-fee-and-channel-promo', spec: '§5.3-3', draft: d([cc({ qty: 2 })], { channelCode: 'grab', paymentCode: 'qr' }) },
  { id: 'c04a-bill-pct-after-line-discounts', spec: '§5.3-4', draft: d([tt({ qty: 2, discountBaht: 5 })], { billDiscountPercent: 10, billDiscountReason: 'สมาชิก', skipPromotionIds: [P(1)] }) },
  { id: 'c04b-code-bill-discount-max-amount', spec: '§5.3-4', draft: d([mt({ size: '20 oz', qty: 3 })], { promoCode: 'DAYO10' }) },
  { id: 'c05a-bundle-cocoa-thai-tea', spec: '§5.3-5', draft: d([cc(), tt()]) },
  { id: 'c05b-buy2get1-qty4', spec: '§5.3-5', draft: d([tt({ qty: 4 })]) },
  { id: 'c06a-oat-premium-matcha', spec: '§5.3-6', draft: d([mt({ milk: 'oat', grade: 'Premium' })]) },
  { id: 'c06b-oat-without-fresh-milk', spec: '§5.3-6', draft: d([cc({ milk: 'oat' })]) },
  { id: 'c07a-time-before', spec: '§5.3-7', draft: d([mt()], { saleTime: '13:59' }) },
  { id: 'c07b-time-inside', spec: '§5.3-7', draft: d([mt()], { saleTime: '14:30' }) },
  { id: 'c07c-time-after', spec: '§5.3-7', draft: d([mt()], { saleTime: '16:01' }) },
  { id: 'c07d-time-saturday', spec: '§5.3-7', draft: d([mt()], { saleDate: '2026-09-26', saleTime: '14:30' }) },
  { id: 'c08a-skip-one', spec: '§5.3-8', draft: d([tt({ qty: 3 })], { skipPromotionIds: [P(1)] }) },
  { id: 'c08b-no-promotions', spec: '§5.3-8', draft: d([tt({ qty: 3 })], { skipPromotionIds: ALL }) },
  { id: 'c08c-code-promo-without-code', spec: '§5.3-8', draft: d([mt({ size: '20 oz', qty: 3 })]) },
  { id: 'c09a-max-qty-99', spec: '§5.3-9', draft: d([tt({ qty: 99 })]) },
  { id: 'c09b-50-lines-500-cups', spec: '§5.3-9', draft: d(Array.from({ length: 50 }, (_, i) => tt({ sweetness: SWEET[i % 5], size: i % 2 === 0 ? '16 oz' : '20 oz', qty: 10 }))) },
  { id: 'c10a-free-without-reason', spec: '§5.3-10', draft: d([tt({ free: true })]) },
  { id: 'c10b-free-with-reason', spec: '§5.3-10', draft: d([tt({ free: true, discountReason: 'ชดเชยแก้วหก' })]) },
  { id: 'c11b-milk-omitted', spec: '§5.3-11', draft: d([tt({ milk: null })]) },
  { id: 'c12a-grab-promo-on-store', spec: '§5.3-12', draft: d([cc()]) },
  { id: 'c12b-grab-promo-on-grab', spec: '§5.3-12', draft: d([cc()], { channelCode: 'grab', paymentCode: 'qr' }) },
  // The test catalog's timeFrom is "14:00:00", as dayo's E1 sends it, and the POS never truncates it. dayo shared then
  // compares "14:00" < "14:00:00" and gives NO promotion at 14:00 — the seed records that, matching dayo shared but NOT
  // dayo SQL, which compares times and gives it (dayo bug: E1 should send left(time::text,5) like 0020 does).
  { id: 'c13a-at-timeFrom', spec: '§5.3-13', draft: d([mt()], { saleTime: '14:00' }) },
  { id: 'c13b-at-timeTo', spec: '§5.3-13', draft: d([mt()], { saleTime: '16:00' }) },
  { id: 'c15-bill-baht-and-percent', spec: '§5.3-15', draft: d([tt()], { billDiscountBaht: 5, billDiscountPercent: 10, billDiscountReason: 'ผิดรูป' }) },
]
