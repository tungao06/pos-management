import { describe, expect, it } from 'vitest'
import { MovementKind, OrderStatus, SeedSchema, parseSeed } from '../src/index.js'

const minimal = {
  categories: [{ code: 'THAI', name: 'ชาไทย', sort: 1 }],
  sizes: [{ code: '16oz', name: '16 oz', sort: 1, packagingItemCode: 'PK-SET-16' }],
  sweetness: [{ code: 'S050', name: '50%', sort: 3, isDefault: true }],
  channels: [{ code: 'STORE', name: 'หน้าร้าน', commissionBp: 0 }],
  items: [
    { code: 'PK-CUP-01', name: 'แก้ว 16 oz', kind: 'raw', category: 'แก้ว', useUnit: 'ชิ้น', isTracked: true, reorderPointMilli: 100_000, standardCostUsat: 200_000_000, shelfLifeHours: null, note: null },
    { code: 'PK-SET-16', name: 'บรรจุภัณฑ์ 16 oz', kind: 'packaging_set', category: 'บรรจุภัณฑ์', useUnit: 'ชุด', isTracked: false, reorderPointMilli: 0, standardCostUsat: 0, shelfLifeHours: null, note: null },
  ],
  purchaseUnits: [{ itemCode: 'PK-CUP-01', name: 'แพ็ค', qtyPerUnitMilli: 50_000, isDefault: true }],
  boms: [{ itemCode: 'PK-SET-16', yieldMilli: 1_000, lines: [{ itemCode: 'PK-CUP-01', qtyMilli: 1_000 }] }],
  products: [{ code: 'Original', nameTh: 'ชาไทยเย็น', nameEn: 'Original', categoryCode: 'THAI', sort: 1, prepGroup: 'เย็นธรรมดา' }],
  variants: [{ productCode: 'Original', sizeCode: '16oz', sku: 'Original-16oz' }],
  prices: [{ productCode: 'Original', sizeCode: '16oz', channelCode: 'STORE', priceSatang: 4500 }],
  recipes: [{ productCode: 'Original', sizeCode: '16oz', sweetnessCode: 'S050', lines: [{ itemCode: 'PK-SET-16', qtyMilli: 1_000 }], excelCostSatang: 400, excelLiquidMilli: 0 }],
  equipment: [{ code: 'EQ-001', name: 'เหยือก', purchasedAt: '2026-08-31', priceSatang: 13_800, qty: 1, supplier: 'Mr. DIY', lifeYears: 3, condition: 'ใช้งานได้', owner: 'TungAo', note: null }],
}

describe('SeedSchema', () => {
  it('accepts a minimal valid seed', () => {
    expect(parseSeed(minimal).items).toHaveLength(2)
  })
  it('rejects unknown item kind, negative money and non-integer milli', () => {
    expect(() => parseSeed({ ...minimal, items: [{ ...minimal.items[0], kind: 'liquid' }] })).toThrow()
    expect(() => parseSeed({ ...minimal, prices: [{ ...minimal.prices[0], priceSatang: -1 }] })).toThrow()
    expect(() => parseSeed({ ...minimal, boms: [{ ...minimal.boms[0], yieldMilli: 1.5 }] })).toThrow()
  })
  it('rejects a recipe line that references an unknown item code (refinement)', () => {
    const bad = { ...minimal, recipes: [{ ...minimal.recipes[0], lines: [{ itemCode: 'NOPE', qtyMilli: 1 }] }] }
    expect(() => parseSeed(bad)).toThrow(/NOPE/)
  })
  it('exposes enums', () => {
    expect(OrderStatus.options).toContain('pending_verify')
    expect(MovementKind.options).toHaveLength(11)
    expect(SeedSchema).toBeDefined()
  })
})
