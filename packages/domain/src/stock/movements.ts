import { costSatang } from '../money.js'

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

export function needsCostSatang(needs: ReadonlyMap<string, number>, costOf: CostOf): number {
  let total = 0
  for (const [itemId, need] of needs) total += costSatang(need, costOf(itemId))
  return total
}
