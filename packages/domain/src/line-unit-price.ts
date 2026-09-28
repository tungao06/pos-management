import { applyOptions, channelPrice, type MilkCode } from '@dayo/dayo-pricing'
import { edgeBahtToSatang } from './money-edge.js'
import { findSellableVariant, type PosOrderCatalog } from './price-cart.js'

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
  const applied = applyOptions(variant, { milk, grade }, catalog)
  if (!applied.ok) return null
  return edgeBahtToSatang(channelPrice(variant.price + applied.priceAdd, channel))
}
