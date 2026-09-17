import type ExcelJS from 'exceljs'
import type { z } from 'zod'
import { SeedPrice, SeedProduct, SeedVariant } from '@dayo/contracts'
import { bahtToSatang } from '@dayo/domain'
import { findRow, num, rowsWhile, sheet, str } from './cells.js'
import { PRODUCT_CATEGORY, SIZES } from './constants.js'

type Product = z.infer<typeof SeedProduct>
type Variant = z.infer<typeof SeedVariant>
type Price = z.infer<typeof SeedPrice>

function prepGroups(wb: ExcelJS.Workbook): Map<string, string> {
  const ws = sheet(wb, 'SOP วิธีชง')
  const header = findRow(ws, (r) => str(ws, r, 1) === 'เมนู' && str(ws, r, 3) === 'กลุ่มเทคนิค')
  const out = new Map<string, string>()
  for (const r of rowsWhile(ws, header + 1, 1)) out.set(str(ws, r, 1), str(ws, r, 3))
  return out
}

export function parseProducts(wb: ExcelJS.Workbook): { products: Product[]; variants: Variant[]; prices: Price[] } {
  const ws = sheet(wb, 'ต้นทุนและราคา')
  const header = findRow(ws, (r) => str(ws, r, 1) === 'เมนู' && str(ws, r, 3) === '16 oz')
  const groups = prepGroups(wb)
  const products: Product[] = []
  const variants: Variant[] = []
  const prices: Price[] = []
  let sort = 0
  for (const r of rowsWhile(ws, header + 1, 1)) {
    const code = str(ws, r, 1)
    const categoryCode = PRODUCT_CATEGORY[code]
    if (!categoryCode) throw new Error(`product "${code}" missing in PRODUCT_CATEGORY`)
    sort += 1
    products.push(SeedProduct.parse({ code, nameTh: str(ws, r, 2), nameEn: code, categoryCode, sort, prepGroup: groups.get(code) ?? null }))
    for (const s of SIZES) {
      variants.push(SeedVariant.parse({ productCode: code, sizeCode: s.code, sku: `${code}-${s.code}` }))
      prices.push(SeedPrice.parse({ productCode: code, sizeCode: s.code, channelCode: 'STORE', priceSatang: bahtToSatang(num(ws, r, s.priceCol)) }))
    }
  }
  return { products, variants, prices }
}
