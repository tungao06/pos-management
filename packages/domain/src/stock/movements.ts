import { assertSafeInt, roundDivBig } from '../money.js'

export type MovementKind =
  | 'OPENING' | 'PURCHASE' | 'SALE' | 'VOID_RETURN' | 'PRODUCE_OUT' | 'PRODUCE_IN'
  | 'WASTE' | 'EXPIRED' | 'COUNT_ADJ' | 'TRIAL' | 'TRANSFER'

export type MovementDraft = {
  itemId: string
  kind: MovementKind
  qtyMilli: number
  unitCostUsat: number
  refType: string
  refId: string
}

export type CostOf = (itemId: string) => number

export function saleMovements(needs: ReadonlyMap<string, number>, costOf: CostOf, orderId: string): MovementDraft[] {
  const out: MovementDraft[] = []
  for (const [itemId, need] of needs) {
    if (need === 0) continue
    out.push({ itemId, kind: 'SALE', qtyMilli: -need, unitCostUsat: costOf(itemId), refType: 'order', refId: orderId })
  }
  return out
}

export function voidReturnMovements(sale: readonly MovementDraft[], orderId: string): MovementDraft[] {
  return sale.map((m) => ({ ...m, kind: 'VOID_RETURN', qtyMilli: -m.qtyMilli, refType: 'order', refId: orderId }))
}

/**
 * Total cost in satang of `needs`, rounded once over the full-precision BigInt sum (spec §4.2).
 * Rounding each ingredient's cost separately and summing the results drifts from Excel; see `lineUnitCostSatang`
 * for the per-unit (per-cup) cost, which divides this same single-rounded sum by qty.
 */
export function needsCostSatang(needs: ReadonlyMap<string, number>, costOf: CostOf): number {
  let totalMilliUsat = 0n
  for (const [itemId, need] of needs) {
    assertSafeInt(need, 'need')
    const unitCostUsat = costOf(itemId)
    assertSafeInt(unitCostUsat, 'unitCostUsat')
    totalMilliUsat += BigInt(need) * BigInt(unitCostUsat)
  }
  return Number(roundDivBig(totalMilliUsat, 1_000_000_000n))
}

/**
 * Per-unit cost in satang for a batch of `qty` identical units whose combined ingredient needs are `needs`
 * (spec §4.2: `unit_cost_satang = round(Σ need × cost / 1000 / qty)`). Rounds once over the full-precision
 * BigInt sum, then divides by `qty` — never round per line and never divide by qty before rounding.
 */
export function lineUnitCostSatang(needs: ReadonlyMap<string, number>, costOf: CostOf, qty: number): number {
  assertSafeInt(qty, 'qty')
  if (qty <= 0) throw new RangeError('qty must be > 0')
  let totalMilliUsat = 0n
  for (const [itemId, need] of needs) {
    assertSafeInt(need, 'need')
    const unitCostUsat = costOf(itemId)
    assertSafeInt(unitCostUsat, 'unitCostUsat')
    totalMilliUsat += BigInt(need) * BigInt(unitCostUsat)
  }
  return Number(roundDivBig(totalMilliUsat, 1_000_000_000n * BigInt(qty)))
}
