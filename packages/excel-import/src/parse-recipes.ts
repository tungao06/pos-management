import type ExcelJS from 'exceljs'
import type { z } from 'zod'
import { SeedRecipe } from '@dayo/contracts'
import { bahtToSatang } from '@dayo/domain'
import { num, rowsWhile, sheet, str } from './cells.js'
import { RECIPE_INGREDIENT_TO_ITEM, SIZES, SWEETNESS } from './constants.js'

type Recipe = z.infer<typeof SeedRecipe>

const sizeByName = new Map<string, (typeof SIZES)[number]>(SIZES.map((s) => [s.name, s]))
const sweetByName = new Map<string, string>(SWEETNESS.map((s) => [s.name, s.code]))

export function parseRecipes(wb: ExcelJS.Workbook): Recipe[] {
  const ws = sheet(wb, 'ข้อมูลสูตร')
  // header row 1: Key | เมนู | ขนาด | ความหวาน | <17 ingredient columns "ชื่อ (unit)"> | ของเหลวรวม (ml) | ต้นทุน/แก้ว (บาท) | ...
  const ingredientCols: { col: number; itemCode: string }[] = []
  let liquidCol = 0
  let costCol = 0
  for (let c = 1; c <= ws.columnCount; c++) {
    const h = str(ws, 1, c)
    if (h === 'ของเหลวรวม (ml)') liquidCol = c
    else if (h === 'ต้นทุน/แก้ว (บาท)') costCol = c
    else {
      const name = h.replace(/\s*\((ml|g)\)$/, '')
      const itemCode = RECIPE_INGREDIENT_TO_ITEM[name]
      if (itemCode) ingredientCols.push({ col: c, itemCode })
    }
  }
  if (ingredientCols.length !== 17) throw new Error(`expected 17 ingredient columns, found ${ingredientCols.length}`)
  if (!liquidCol || !costCol) throw new Error('ข้อมูลสูตร: liquid/cost columns not found')

  const recipes: Recipe[] = []
  for (const r of rowsWhile(ws, 2, 1)) {
    const size = sizeByName.get(str(ws, r, 3))
    const sweetnessCode = sweetByName.get(str(ws, r, 4))
    if (!size || !sweetnessCode) throw new Error(`ข้อมูลสูตร row ${r}: unknown size/sweetness "${str(ws, r, 3)}" "${str(ws, r, 4)}"`)
    const lines = ingredientCols
      .map(({ col, itemCode }) => ({ itemCode, qtyMilli: Math.round(num(ws, r, col) * 1000) }))
      .filter((l) => l.qtyMilli > 0)
    lines.push({ itemCode: size.packagingItemCode, qtyMilli: 1000 })
    recipes.push(
      SeedRecipe.parse({
        productCode: str(ws, r, 2),
        sizeCode: size.code,
        sweetnessCode,
        lines,
        excelCostSatang: bahtToSatang(num(ws, r, costCol)),
        excelLiquidMilli: Math.round(num(ws, r, liquidCol) * 1000),
      }),
    )
  }
  return recipes
}
