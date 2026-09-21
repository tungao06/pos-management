import { loadCatalogSqlite, type RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { isPriceJump, purchaseMovements, purchaseUnitCostUsat, unitsToUseMilli, type PurchaseLineDraft } from '@dayo/domain'
import { enqueueOutbox } from '../db/outbox'
import { insertMovements } from '../db/stock'
import { currentOpenShift, requireDevice } from './bootstrap'
import { insertManualCashMovement } from './cash'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { requireActiveUser } from './shift'
import { assertUnitsMilli, badInputOnRange, cleanText, lastPurchaseCosts, MAX_LINE_SATANG, MAX_STOCK_LINES, qtyPerUnitMilli, requireStockItem, stockBusinessDate } from './stock-common'
import { REASON_MAX_LENGTH, type PurchaseDto, type ReceivePurchaseInput } from './types'

/**
 * รับของเข้า (spec §5, D19): one receipt = purchase + purchase_line + PURCHASE movements (moving average, spec §4.4) +
 * item_cost_state + outbox, in one transaction. Tracked raw items only (D29): `requireStockItem` is called with no
 * options, so an inactive item is refused whatever its stock (review I-1, Task 4 fix round 1 — receiving never opts
 * into the Task 3 `allowInactiveWithStock` escape hatch). A unit cost more than 10% off the item's last purchase
 * price (or its standard cost if never bought — Q4-15) is refused with PRICE_JUMP until the person confirms it
 * (D47 item 3); the codes in its detail are de-duplicated (review m-4). With `paidFromDrawer` and a non-zero total,
 * the total also leaves the drawer as a PAID_OUT of the open shift, in the same transaction, through the same cap
 * as a manual paid-out (`insertManualCashMovement` — Q4-6) — checked for an open shift *before* any price jump is
 * even considered (review m-2), so the person is not asked to confirm a jump only to learn there is no shift to pay
 * from. A wholly free receipt (`totalSatang === 0`) never touches the drawer at all — nothing to pay out — rather
 * than fail with a confusing amount error (review m-1).
 */
export async function receivePurchase(db: RemoteDb, deps: ApiDeps, input: ReceivePurchaseInput): Promise<PurchaseDto> {
  const actor = await requireActiveUser(db, input.actorUserId)
  if (input.lines.length === 0) throw new PosError('BAD_INPUT', 'a purchase needs at least one line')
  if (input.lines.length > MAX_STOCK_LINES) throw new PosError('BAD_INPUT', `at most ${MAX_STOCK_LINES} lines`)
  const supplier = cleanText(input.supplier, 'supplier', false)
  const note = cleanText(input.note, 'note', false)
  for (const l of input.lines) {
    assertUnitsMilli(l.qtyUnitsMilli, 'qtyUnitsMilli')
    if (!Number.isSafeInteger(l.lineTotalSatang) || l.lineTotalSatang < 0 || l.lineTotalSatang > MAX_LINE_SATANG) {
      throw new PosError('BAD_INPUT', `a line total is a whole number of satang from 0 to ${MAX_LINE_SATANG}`)
    }
  }
  const device = await requireDevice(db)

  return db.transaction(async (tx) => {
    const at = deps.now()
    const businessDate = await stockBusinessDate(tx, device.id, at)
    const catalog = await loadCatalogSqlite(tx)
    const lastCosts = await lastPurchaseCosts(tx)
    const purchaseId = deps.newId()
    const drafts: PurchaseLineDraft[] = []
    const lineRows: (typeof s.purchaseLine.$inferInsert & { id: string })[] = []
    const out: PurchaseDto['lines'] = []
    const jumps: string[] = []
    for (const l of input.lines) {
      const item = await requireStockItem(tx, l.itemId, ['raw'])
      const perUnit = await qtyPerUnitMilli(tx, item.id, l.purchaseUnitId)
      const qtyUseMilli = badInputOnRange(() => unitsToUseMilli(l.qtyUnitsMilli, perUnit))
      if (qtyUseMilli <= 0) throw new PosError('BAD_INPUT', `line of ${item.code} rounds to nothing`)
      const unitCostUsat = badInputOnRange(() => purchaseUnitCostUsat(l.lineTotalSatang, qtyUseMilli))
      // m-4 (Task 4 fix round 1): two jumping lines of the same item must not repeat its code in the detail.
      if (isPriceJump(unitCostUsat, lastCosts.get(item.id) ?? item.standardCostUsat) && !jumps.includes(item.code)) jumps.push(item.code)
      drafts.push({ itemId: item.id, qtyUseMilli, lineTotalSatang: l.lineTotalSatang })
      lineRows.push({
        id: deps.newId(),
        purchaseId,
        itemId: item.id,
        purchaseUnitId: l.purchaseUnitId,
        qtyUnitsMilli: l.qtyUnitsMilli,
        qtyUseMilli,
        lineTotalSatang: l.lineTotalSatang,
      } satisfies typeof s.purchaseLine.$inferInsert)
      out.push({ itemId: item.id, code: item.code, name: item.name, qtyUseMilli, lineTotalSatang: l.lineTotalSatang, unitCostUsat })
    }
    const totalSatang = drafts.reduce((a, d) => a + d.lineTotalSatang, 0)

    // m-1 (Task 4 fix round 1): a wholly free receipt pays nothing out — `paidFromDrawer` is then a no-op, not an
    // error, and no shift is even required for it.
    const payFromDrawer = input.paidFromDrawer && totalSatang > 0
    // m-2 (Task 4 fix round 1): the drawer's own requirement (an open shift) is checked before PRICE_JUMP, so a
    // person with no shift open is not first asked to confirm a price jump for a payment that cannot happen anyway.
    const shift = payFromDrawer ? await currentOpenShift(tx, device.id) : null
    if (payFromDrawer && shift === null) throw new PosError('NO_OPEN_SHIFT', 'paying from the drawer needs an open shift')

    if (jumps.length > 0 && !input.acceptPriceJump) throw new PosError('PRICE_JUMP', jumps.join(','))

    let cashMovementId: string | null = null
    if (payFromDrawer && shift !== null) {
      // m-5 (Task 4 fix round 1): cut on code points — never inside a surrogate pair (an emoji supplier name).
      const reason = truncateCodePoints(supplier === '' ? 'รับของ' : `รับของ ${supplier}`, REASON_MAX_LENGTH)
      const cash = await insertManualCashMovement(tx, deps, { shiftId: shift.id, kind: 'PAID_OUT', amountSatang: totalSatang, reason, actorId: actor.id, at })
      cashMovementId = cash.id
    }

    const purchaseRow = {
      id: purchaseId,
      businessDate,
      supplier: supplier === '' ? null : supplier,
      totalSatang,
      receiptImageRef: null, // Q4-5: the receipt photo waits for plan 5 (upload)
      note: note === '' ? null : note,
      deviceId: device.id,
      createdBy: actor.id,
      createdAt: at,
    } satisfies typeof s.purchase.$inferInsert
    await tx.insert(s.purchase).values(purchaseRow)
    await enqueueOutbox(tx, 'purchase', purchaseRow, at, deps.newId)
    for (const row of lineRows) {
      await tx.insert(s.purchaseLine).values(row)
      await enqueueOutbox(tx, 'purchase_line', row, at, deps.newId)
    }
    await insertMovements(tx, deps, purchaseMovements(drafts, purchaseId), { businessDate, deviceId: device.id, createdBy: actor.id, at }, catalog)
    return { id: purchaseId, businessDate, supplier: purchaseRow.supplier, totalSatang, lines: out, cashMovementId, createdAt: at }
  })
}

/**
 * Slices `text` to at most `max` Unicode code points — `Array.from` iterates by code point, so a surrogate pair
 * (an emoji) is kept whole or dropped whole, never split into a lone surrogate the way `String.slice` would
 * (review m-5, Task 4 fix round 1).
 */
function truncateCodePoints(text: string, max: number): string {
  return Array.from(text).slice(0, max).join('')
}
