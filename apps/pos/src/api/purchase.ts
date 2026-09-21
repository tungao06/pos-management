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
 * item_cost_state + outbox, in one transaction. Tracked raw items only (D29). A unit cost more than 10% off the item's
 * last purchase price (or its standard cost if never bought — Q4-15) is refused with PRICE_JUMP until the person
 * confirms it (D47 item 3). With `paidFromDrawer` the total also leaves the drawer as a PAID_OUT of the open shift, in
 * the same transaction, through the same cap as a manual paid-out (`insertManualCashMovement` — Q4-6).
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
      if (isPriceJump(unitCostUsat, lastCosts.get(item.id) ?? item.standardCostUsat)) jumps.push(item.code)
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
    if (jumps.length > 0 && !input.acceptPriceJump) throw new PosError('PRICE_JUMP', jumps.join(','))
    const totalSatang = drafts.reduce((a, d) => a + d.lineTotalSatang, 0)

    let cashMovementId: string | null = null
    if (input.paidFromDrawer) {
      const shift = await currentOpenShift(tx, device.id)
      if (shift === null) throw new PosError('NO_OPEN_SHIFT', 'paying from the drawer needs an open shift')
      const reason = (supplier === '' ? 'รับของ' : `รับของ ${supplier}`).slice(0, REASON_MAX_LENGTH)
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
