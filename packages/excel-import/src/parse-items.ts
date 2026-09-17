import type ExcelJS from 'exceljs'
import type { z } from 'zod'
import { SeedItem, SeedPurchaseUnit, UseUnit } from '@dayo/contracts'
import { bahtToUsat } from '@dayo/domain'
import { num, rowsWhile, sheet, str } from './cells.js'
import { PENDING_ITEM_CODES, UNTRACKED_ITEM_CODES } from './constants.js'

type Item = z.infer<typeof SeedItem>
type PU = z.infer<typeof SeedPurchaseUnit>

const COL = { code: 1, name: 2, kind: 3, category: 4, purchaseUnit: 5, qtyPerUnit: 6, useUnit: 7, price: 8, reorder: 9, note: 10 } as const
const FIRST_ROW = 6

export function parseItems(wb: ExcelJS.Workbook): { items: Item[]; purchaseUnits: PU[] } {
  const ws = sheet(wb, 'สินค้าและสต็อก')
  if (str(ws, 5, COL.code) !== 'รหัสสินค้า') throw new Error('สินค้าและสต็อก: header row moved')
  const items: Item[] = []
  const purchaseUnits: PU[] = []
  for (const r of rowsWhile(ws, FIRST_ROW, COL.code)) {
    const code = str(ws, r, COL.code)
    if (PENDING_ITEM_CODES.has(code)) continue
    const qtyPerUnit = num(ws, r, COL.qtyPerUnit)
    if (qtyPerUnit <= 0) throw new Error(`${code}: ปริมาณต่อหน่วยซื้อ must be > 0`)
    const pricePerUnit = num(ws, r, COL.price)
    const useUnit = UseUnit.parse(str(ws, r, COL.useUnit))
    items.push(
      SeedItem.parse({
        code,
        name: str(ws, r, COL.name),
        kind: 'raw',
        category: str(ws, r, COL.category),
        useUnit,
        isTracked: !UNTRACKED_ITEM_CODES.has(code),
        reorderPointMilli: Math.round(num(ws, r, COL.reorder) * 1000),
        standardCostUsat: bahtToUsat(pricePerUnit / qtyPerUnit),
        shelfLifeHours: null,
        note: str(ws, r, COL.note) || null,
      }),
    )
    purchaseUnits.push(SeedPurchaseUnit.parse({ itemCode: code, name: str(ws, r, COL.purchaseUnit), qtyPerUnitMilli: Math.round(qtyPerUnit * 1000), isDefault: true }))
  }
  return { items, purchaseUnits }
}
