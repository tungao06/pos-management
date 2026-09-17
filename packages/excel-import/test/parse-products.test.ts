import { describe, expect, it } from 'vitest'
import { parseProducts } from '../src/parse-products.js'
import { loadFixture } from './workbook.js'

describe('parseProducts', () => {
  it('reads 24 products × 3 sizes with store prices', async () => {
    const { products, variants, prices } = parseProducts(await loadFixture())
    expect(products).toHaveLength(24)
    expect(variants).toHaveLength(72)
    expect(prices).toHaveLength(72)
    expect(products.map((p) => p.code).slice(0, 3)).toEqual(['Original', 'Latte', 'Cream Cheese'])
  })
  it('maps Original: ชาไทยเย็น, category THAI, 45/50/55 baht, prep group เย็นธรรมดา', async () => {
    const { products, prices } = parseProducts(await loadFixture())
    expect(products.find((p) => p.code === 'Original')).toEqual({ code: 'Original', nameTh: 'ชาไทยเย็น', nameEn: 'Original', categoryCode: 'THAI', sort: 1, prepGroup: 'เย็นธรรมดา' })
    const p = (size: string) => prices.find((x) => x.productCode === 'Original' && x.sizeCode === size)!.priceSatang
    expect([p('16oz'), p('20oz'), p('22oz')]).toEqual([4500, 5000, 5500])
  })
  it('maps Matcha Strawberry Premium prices 95/110/120', async () => {
    const { prices } = parseProducts(await loadFixture())
    const p = (size: string) => prices.find((x) => x.productCode === 'Matcha Strawberry Premium' && x.sizeCode === size)!.priceSatang
    expect([p('16oz'), p('20oz'), p('22oz')]).toEqual([9500, 11000, 12000])
  })
})
