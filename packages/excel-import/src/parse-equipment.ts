import type ExcelJS from 'exceljs'
import type { z } from 'zod'
import { SeedEquipment } from '@dayo/contracts'
import { bahtToSatang } from '@dayo/domain'
import { cellValue, isoDate, num, rowsWhile, sheet, str } from './cells.js'

type Equipment = z.infer<typeof SeedEquipment>

/**
 * D37: the register stores useful life in years; the database stores whole months. years × 12 must come out
 * as an exact integer — never round it away. A blank or zero life means "unknown" (null).
 */
export function lifeMonthsFromYears(years: number, code: string): number | null {
  if (!(years > 0)) return null
  const months = years * 12
  if (!Number.isInteger(months)) throw new Error(`ทะเบียนอุปกรณ์ ${code}: life ${years} years is not a whole number of months (× 12 = ${months})`)
  return months
}

export function parseEquipment(wb: ExcelJS.Workbook): Equipment[] {
  const ws = sheet(wb, 'ทะเบียนอุปกรณ์')
  if (str(ws, 5, 1) !== 'รหัสอุปกรณ์') throw new Error('ทะเบียนอุปกรณ์: header row moved')
  const out: Equipment[] = []
  for (const r of rowsWhile(ws, 6, 1)) {
    const code = str(ws, r, 1)
    out.push(
      SeedEquipment.parse({
        code,
        name: str(ws, r, 2),
        purchasedAt: isoDate(cellValue(ws, r, 3)),
        priceSatang: bahtToSatang(num(ws, r, 4)),
        qty: Math.max(1, Math.round(num(ws, r, 5))),
        supplier: str(ws, r, 6) || null,
        lifeMonths: lifeMonthsFromYears(num(ws, r, 7), code),
        condition: str(ws, r, 9) || null,
        owner: str(ws, r, 10) || null,
        note: str(ws, r, 11) || null,
      }),
    )
  }
  return out
}
