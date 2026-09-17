import { fileURLToPath } from 'node:url'
import { openWorkbook } from '../src/cells.js'
import type ExcelJS from 'exceljs'

let cached: Promise<ExcelJS.Workbook> | undefined
export function loadFixture(): Promise<ExcelJS.Workbook> {
  cached ??= openWorkbook(fileURLToPath(new URL('../fixtures/DA-YO_เมนู.xlsx', import.meta.url)))
  return cached
}
