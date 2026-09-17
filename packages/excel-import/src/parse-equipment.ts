import type ExcelJS from 'exceljs'
import type { z } from 'zod'
import { SeedEquipment } from '@dayo/contracts'
import { bahtToSatang } from '@dayo/domain'
import { cellValue, isoDate, num, rowsWhile, sheet, str } from './cells.js'

type Equipment = z.infer<typeof SeedEquipment>

export function parseEquipment(wb: ExcelJS.Workbook): Equipment[] {
  const ws = sheet(wb, 'ทะเบียนอุปกรณ์')
  if (str(ws, 5, 1) !== 'รหัสอุปกรณ์') throw new Error('ทะเบียนอุปกรณ์: header row moved')
  const out: Equipment[] = []
  for (const r of rowsWhile(ws, 6, 1)) {
    const life = num(ws, r, 7)
    out.push(
      SeedEquipment.parse({
        code: str(ws, r, 1),
        name: str(ws, r, 2),
        purchasedAt: isoDate(cellValue(ws, r, 3)),
        priceSatang: bahtToSatang(num(ws, r, 4)),
        qty: Math.max(1, Math.round(num(ws, r, 5))),
        supplier: str(ws, r, 6) || null,
        lifeYears: life > 0 ? life : null,
        condition: str(ws, r, 9) || null,
        owner: str(ws, r, 10) || null,
        note: str(ws, r, 11) || null,
      }),
    )
  }
  return out
}
