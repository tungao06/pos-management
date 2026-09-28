import { applyOptions, channelPrice, type MilkCode } from '@dayo/dayo-pricing'
import { edgeBahtToSatang } from './money-edge.js'
import { dayoOptions, findSellableVariant, type PosOrderCatalog } from './price-cart.js'

/**
 * The unit price of one size+sweetness+milk+grade combo on one channel, priced the exact way dayo's own
 * `computeOrder` prices a cart line (review I1): `channelPrice(variant.price + applyOptions(...).priceAdd, channel)`,
 * then to satang at the money edge. `ItemDialog` calls this directly for both the big price and every option
 * button's "+฿" label (the difference of two calls) — it never adds milk/grade/channel money itself.
 *
 * `null` when the channel is unknown, the size is closed, the menu/variant no longer exists, or the option itself is
 * not offered on this variant (e.g. oat on a menu with no fresh-milk line) — never throws.
 */
export function lineUnitPriceSatang(
  catalog: PosOrderCatalog,
  code: string,
  size: string,
  sweetness: string,
  milk: MilkCode,
  grade: string | null,
  channelCode: string,
): number | null {
  const channel = catalog.channels.find((c) => c.code === channelCode)
  if (channel === undefined) return null
  let variant
  try {
    variant = findSellableVariant(catalog, code, size, sweetness)
  } catch {
    return null
  }
  const applied = applyOptions(variant, { milk, grade }, dayoOptions(catalog))
  if (!applied.ok) return null
  return edgeBahtToSatang(channelPrice(variant.price + applied.priceAdd, channel))
}

/**
 * The "+฿"/"-฿" a screen shows on an option button — `lineUnitPriceSatang(to) - lineUnitPriceSatang(from)`, computed
 * entirely here so no subtraction (or any other money arithmetic) ever runs in a screen (review round 2 item 5).
 * `null` when either side cannot be priced (closed size, unknown channel, option not offered).
 */
export function optionDeltaSatang(
  catalog: PosOrderCatalog,
  code: string,
  size: string,
  sweetness: string,
  channelCode: string,
  from: { milk: MilkCode; grade: string | null },
  to: { milk: MilkCode; grade: string | null },
): number | null {
  const a = lineUnitPriceSatang(catalog, code, size, sweetness, from.milk, from.grade, channelCode)
  const b = lineUnitPriceSatang(catalog, code, size, sweetness, to.milk, to.grade, channelCode)
  return a === null || b === null ? null : b - a
}
