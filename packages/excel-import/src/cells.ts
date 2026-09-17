import ExcelJS from 'exceljs'

export async function openWorkbook(path: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)
  return wb
}

export function sheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const ws = wb.getWorksheet(name)
  if (!ws) throw new Error(`sheet "${name}" not found; sheets: ${wb.worksheets.map((w) => w.name).join(', ')}`)
  return ws
}

/** Unwrap exceljs cell values: formula → cached result, rich text → plain text. */
export function cellValue(ws: ExcelJS.Worksheet, row: number, col: number): unknown {
  const cell = ws.getCell(row, col)
  const v = cell.value as unknown
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('result' in o) return o['result'] ?? null
    if ('richText' in o) return (o['richText'] as { text: string }[]).map((t) => t.text).join('')
    if ('text' in o) return o['text']
    if ('error' in o) return null
    // Shared formula (e.g. `{ sharedFormula: 'E242' }`): exceljs's `.value` getter for a
    // non-master cell in a shared-formula range doesn't surface the cached result even though
    // it parsed one — read it off `cell.result` instead.
    if ('sharedFormula' in o) return (cell as unknown as { result?: unknown }).result ?? null
    // Cross-sheet formula with no cached result (e.g. `เบสและซับสูตร!$B$13`): the workbook
    // didn't persist a calculated value for this cell. Treat as unknown/empty rather than
    // returning the raw { formula } object, which str()/num() cannot stringify or add.
    if ('formula' in o) return null
  }
  return v
}

export function str(ws: ExcelJS.Worksheet, row: number, col: number): string {
  const v = cellValue(ws, row, col)
  return v === null ? '' : String(v).trim()
}

export function num(ws: ExcelJS.Worksheet, row: number, col: number): number {
  const v = cellValue(ws, row, col)
  if (v === null || v === '') return 0
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  if (!Number.isFinite(n)) throw new Error(`${ws.name}!R${row}C${col} is not a number: ${String(v)}`)
  return n
}

export function findRow(ws: ExcelJS.Worksheet, pred: (row: number) => boolean, from = 1): number {
  const last = ws.rowCount
  for (let r = from; r <= last; r++) if (pred(r)) return r
  throw new Error(`row not found in sheet "${ws.name}"`)
}

/** Iterate rows from `start` while column `keyCol` is non-empty. */
export function* rowsWhile(ws: ExcelJS.Worksheet, start: number, keyCol: number): Generator<number> {
  for (let r = start; r <= ws.rowCount; r++) {
    if (str(ws, r, keyCol) === '') return
    yield r
  }
}

export function isoDate(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  return null
}
