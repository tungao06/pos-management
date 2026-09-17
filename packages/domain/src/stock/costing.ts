import { assertSafeInt, roundDivBig } from '../money.js'
import type { Bom } from './catalog.js'
import type { CostOf, MovementDraft } from './movements.js'

export type CostState = { onHandMilli: number; avgCostUsat: number }
export const EMPTY_COST_STATE: CostState = { onHandMilli: 0, avgCostUsat: 0 }

/**
 * Cost state before any movement, per spec §4.4: "ก่อนมีการซื้อครั้งแรก: avg = standard_cost จากไฟล์"
 * (before the first purchase, avg = the item's standard cost). This lets a SALE or PRODUCE_OUT be costed
 * correctly even when it happens before the item's first inbound movement is ever recorded.
 */
export function initialCostState(standardCostUsat: number): CostState {
  assertSafeInt(standardCostUsat, 'standardCostUsat')
  return { onHandMilli: 0, avgCostUsat: standardCostUsat }
}

export function applyMovement(s: CostState, m: { qtyMilli: number; unitCostUsat: number }): CostState {
  assertSafeInt(m.qtyMilli, 'qtyMilli')
  assertSafeInt(m.unitCostUsat, 'unitCostUsat')
  if (m.qtyMilli <= 0) return { onHandMilli: s.onHandMilli + m.qtyMilli, avgCostUsat: s.avgCostUsat }
  if (s.onHandMilli <= 0) return { onHandMilli: s.onHandMilli + m.qtyMilli, avgCostUsat: m.unitCostUsat }
  const num = BigInt(s.onHandMilli) * BigInt(s.avgCostUsat) + BigInt(m.qtyMilli) * BigInt(m.unitCostUsat)
  const den = BigInt(s.onHandMilli + m.qtyMilli)
  return { onHandMilli: s.onHandMilli + m.qtyMilli, avgCostUsat: Number(roundDivBig(num, den)) }
}

export function rebuildCostState(movements: readonly { qtyMilli: number; unitCostUsat: number }[], standardCostUsat = 0): CostState {
  return movements.reduce(applyMovement, initialCostState(standardCostUsat))
}

export function productionMovements(
  bom: Bom,
  scaleBp: number,
  yieldActualMilli: number,
  costOf: CostOf,
  batchId: string,
): { outs: MovementDraft[]; inn: MovementDraft; batchCostSatang: number; unitCostUsat: number } {
  assertSafeInt(scaleBp, 'scaleBp')
  assertSafeInt(yieldActualMilli, 'yieldActualMilli')
  if (scaleBp <= 0) throw new RangeError('scaleBp must be > 0')
  if (yieldActualMilli <= 0) throw new RangeError('yieldActualMilli must be > 0')
  const ref = { refType: 'production_batch', refId: batchId } as const
  let totalMilliUsat = 0n
  const outs: MovementDraft[] = []
  for (const line of bom.lines) {
    const qty = Number(roundDivBig(BigInt(line.qtyMilli) * BigInt(scaleBp), 10_000n))
    if (qty === 0) continue
    const unitCostUsat = costOf(line.itemId)
    totalMilliUsat += BigInt(qty) * BigInt(unitCostUsat)
    outs.push({ itemId: line.itemId, kind: 'PRODUCE_OUT', qtyMilli: -qty, unitCostUsat, ...ref })
  }
  const unitCostUsat = Number(roundDivBig(totalMilliUsat, BigInt(yieldActualMilli)))
  const inn: MovementDraft = { itemId: bom.itemId, kind: 'PRODUCE_IN', qtyMilli: yieldActualMilli, unitCostUsat, ...ref }
  return { outs, inn, batchCostSatang: Number(roundDivBig(totalMilliUsat, 1_000_000_000n)), unitCostUsat }
}
