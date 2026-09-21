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

export type InboundLine = { qtyMilli: number; unitCostUsat: number }

/**
 * One document's inbound lines of one item applied as a single receipt (Q4-17 ก · D57): total qty = Σ qty, total
 * cost = Σ qty × unit cost, rounded once. At on-hand <= 0 avg = total cost ÷ total qty; otherwise the moving average
 * over the state and the whole group. Line order never matters, and a single line equals {@link applyMovement}.
 */
export function applyInboundGroup(s: CostState, lines: readonly InboundLine[]): CostState {
  if (lines.length === 0) return s
  let qty = 0n
  let cost = 0n
  for (const l of lines) {
    assertSafeInt(l.qtyMilli, 'qtyMilli')
    assertSafeInt(l.unitCostUsat, 'unitCostUsat')
    if (l.qtyMilli <= 0) throw new RangeError(`inbound group qtyMilli must be > 0, got ${l.qtyMilli}`)
    qty += BigInt(l.qtyMilli)
    cost += BigInt(l.qtyMilli) * BigInt(l.unitCostUsat)
  }
  const onHandMilli = Number(BigInt(s.onHandMilli) + qty)
  assertSafeInt(onHandMilli, 'onHandMilli')
  if (s.onHandMilli <= 0) return { onHandMilli, avgCostUsat: Number(roundDivBig(cost, qty)) }
  const num = BigInt(s.onHandMilli) * BigInt(s.avgCostUsat) + cost
  return { onHandMilli, avgCostUsat: Number(roundDivBig(num, BigInt(onHandMilli))) }
}

/**
 * Replays one item's movements from its standard cost (spec §4.4 rebuild). Movements that carry `refType`/`refId`
 * apply each run of consecutive positive movements of the same document as one receipt ({@link applyInboundGroup},
 * the same fold `insertMovements` uses); movements without refs keep the per-movement fold.
 */
export function rebuildCostState(movements: readonly (InboundLine & { refType?: string; refId?: string })[], standardCostUsat = 0): CostState {
  let state = initialCostState(standardCostUsat)
  let run: InboundLine[] = []
  let runKey: string | null = null
  for (const m of movements) {
    const key = m.qtyMilli > 0 && m.refType !== undefined && m.refId !== undefined ? JSON.stringify([m.refType, m.refId]) : null
    if (key !== null && key === runKey) {
      run.push(m)
      continue
    }
    state = applyInboundGroup(state, run)
    run = []
    runKey = key
    if (key !== null) run.push(m)
    else state = applyMovement(state, m)
  }
  return applyInboundGroup(state, run)
}

/**
 * `qtyMilli` × `scaleBp` / 10,000, rounded once half away from zero (spec §3.3 scale_bp: 10,000 = one batch) — a
 * component's need and the standard yield of a scaled batch (the produce screen's default yield, spec §5).
 */
export function scaleQtyMilli(qtyMilli: number, scaleBp: number): number {
  assertSafeInt(qtyMilli, 'qtyMilli')
  assertSafeInt(scaleBp, 'scaleBp')
  return Number(roundDivBig(BigInt(qtyMilli) * BigInt(scaleBp), 10_000n))
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
    const qty = scaleQtyMilli(line.qtyMilli, scaleBp)
    if (qty === 0) continue
    const unitCostUsat = costOf(line.itemId)
    totalMilliUsat += BigInt(qty) * BigInt(unitCostUsat)
    outs.push({ itemId: line.itemId, kind: 'PRODUCE_OUT', qtyMilli: -qty, unitCostUsat, ...ref })
  }
  const unitCostUsat = Number(roundDivBig(totalMilliUsat, BigInt(yieldActualMilli)))
  const inn: MovementDraft = { itemId: bom.itemId, kind: 'PRODUCE_IN', qtyMilli: yieldActualMilli, unitCostUsat, ...ref }
  return { outs, inn, batchCostSatang: Number(roundDivBig(totalMilliUsat, 1_000_000_000n)), unitCostUsat }
}
