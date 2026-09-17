import { assertSafeInt, roundDivBig } from '../money.js'
import { MAX_BOM_DEPTH, requireBom, requireItem, type BomLine, type Catalog } from './catalog.js'

/**
 * Quantities to deduct from stock for `lines` × `multiplier`, following spec §4.2:
 * raw → stop · prepared & tracked → stop · prepared & untracked, packaging_set → explode through BOM.
 * Returns insertion-ordered Map itemId → milli (all > 0).
 */
export function explodeNeeds(lines: readonly BomLine[], multiplier: number, catalog: Catalog): Map<string, number> {
  assertSafeInt(multiplier, 'multiplier')
  if (multiplier < 1) throw new RangeError('multiplier must be >= 1')
  const acc = new Map<string, number>()
  const visit = (itemId: string, needMilli: number, depth: number): void => {
    if (needMilli === 0) return
    if (depth > MAX_BOM_DEPTH) throw new Error(`BOM cycle or depth exceeded at ${itemId}`)
    const item = requireItem(catalog, itemId)
    const stop = item.kind === 'raw' || (item.kind === 'prepared' && item.isTracked)
    if (stop) {
      acc.set(itemId, (acc.get(itemId) ?? 0) + needMilli)
      return
    }
    const bom = requireBom(catalog, itemId)
    for (const c of bom.lines) {
      const componentNeed = Number(roundDivBig(BigInt(c.qtyMilli) * BigInt(needMilli), BigInt(bom.yieldMilli)))
      visit(c.itemId, componentNeed, depth + 1)
    }
  }
  for (const l of lines) {
    assertSafeInt(l.qtyMilli, 'qtyMilli')
    visit(l.itemId, l.qtyMilli * multiplier, 0)
  }
  return acc
}
