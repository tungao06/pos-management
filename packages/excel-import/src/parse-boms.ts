import type ExcelJS from 'exceljs'
import type { z } from 'zod'
import { SeedBom, SeedItem } from '@dayo/contracts'
import { findRow, num, rowsWhile, sheet, str } from './cells.js'
import { BOM_ALIAS_NAMES, PACKAGING_SETS, PREPARED_ITEMS } from './constants.js'

type Item = z.infer<typeof SeedItem>
type Bom = z.infer<typeof SeedBom>

export function parseBoms(wb: ExcelJS.Workbook): { items: Item[]; boms: Bom[] } {
  const ws = sheet(wb, 'ต้นทุนเบส')

  // Upper table: standard batch size per recipe ingredient name.
  const yieldByName = new Map<string, number>()
  const upperHeader = findRow(ws, (r) => str(ws, r, 1) === 'ลำดับ')
  for (const r of rowsWhile(ws, upperHeader + 1, 1)) {
    yieldByName.set(str(ws, r, 2), num(ws, r, 4))
  }

  // Lower table: BOM lines.
  const bomHeader = findRow(ws, (r) => str(ws, r, 1) === 'รหัส BOM')
  const linesByName = new Map<string, { itemCode: string; qtyMilli: number }[]>()
  for (const r of rowsWhile(ws, bomHeader + 1, 1)) {
    const name = str(ws, r, 2)
    if (BOM_ALIAS_NAMES.has(name)) continue
    const qty = num(ws, r, 5)
    if (qty === 0) continue
    const arr = linesByName.get(name) ?? []
    arr.push({ itemCode: str(ws, r, 3), qtyMilli: Math.round(qty * 1000) })
    linesByName.set(name, arr)
  }

  const items: Item[] = []
  const boms: Bom[] = []
  const takeBom = (code: string, excelName: string): Bom => {
    const yieldUnits = yieldByName.get(excelName)
    const lines = linesByName.get(excelName)
    if (!yieldUnits || yieldUnits <= 0) throw new Error(`no batch size for "${excelName}"`)
    if (!lines || lines.length === 0) throw new Error(`no BOM lines for "${excelName}"`)
    return SeedBom.parse({ itemCode: code, yieldMilli: Math.round(yieldUnits * 1000), lines })
  }

  for (const p of PREPARED_ITEMS) {
    items.push(SeedItem.parse({ code: p.code, name: p.name, kind: 'prepared', category: 'เบส/ซับสูตร', useUnit: p.useUnit, isTracked: true, reorderPointMilli: 0, standardCostUsat: 0, shelfLifeHours: p.shelfLifeHours, note: null }))
    boms.push(takeBom(p.code, p.excelName))
  }
  for (const s of PACKAGING_SETS) {
    items.push(SeedItem.parse({ code: s.code, name: s.name, kind: 'packaging_set', category: 'บรรจุภัณฑ์', useUnit: 'ชุด', isTracked: false, reorderPointMilli: 0, standardCostUsat: 0, shelfLifeHours: null, note: null }))
    boms.push(takeBom(s.code, s.excelName))
  }
  return { items, boms }
}
