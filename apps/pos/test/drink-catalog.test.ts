import { describe, expect, it } from 'vitest'
import { openTestApi } from './helpers/db'

describe('loadDrinkCatalog (AdjustScreen\'s "เป็นแก้ว (ตามสูตร)" picker, spec §5 · Q4-8)', () => {
  it('lists active products/sizes/sweetness in sort order, with the 16 oz / 50% default (D27)', async () => {
    const { api } = await openTestApi()
    const catalog = await api.loadDrinkCatalog()
    expect(catalog.products[0]).toMatchObject({ code: 'Original', nameTh: 'ชาไทยเย็น' })
    expect(catalog.products.length).toBeGreaterThan(1)
    expect(catalog.sizes.map((z) => z.name)).toEqual(['16 oz', '20 oz', '22 oz']) // sort 1..3
    expect(catalog.sweetness.map((x) => x.name)).toEqual(['0%', '25%', '50%', '75%', '100%']) // sort 1..5
    expect(catalog.sizes.find((z) => z.id === catalog.defaultSizeId)?.name).toBe('16 oz')
    expect(catalog.sweetness.find((x) => x.id === catalog.defaultSweetnessId)?.name).toBe('50%') // isDefault
  })

  it('hides an inactive product, leaving other products untouched', async () => {
    const { api, raw } = await openTestApi()
    const before = await api.loadDrinkCatalog()

    raw.prepare("update product set is_active = 0 where code = 'Original'").run()
    const after = await api.loadDrinkCatalog()
    expect(after.products.some((p) => p.code === 'Original')).toBe(false)
    expect(after.products.length).toBe(before.products.length - 1)
    // variants are filtered only by their own is_active (same as the old loadMenu) — no join against the parent
    // product here. AdjustScreen only ever looks up a variant through an already-active product, so an orphaned
    // variant row is never surfaced; adjustStock's own join (adjust.ts) is the real guarantee behind M-11.
  })

  it('hides an inactive variant while its (still active) product and its other variants stay', async () => {
    const { api, raw } = await openTestApi()
    const before = await api.loadDrinkCatalog()
    const original = before.products.find((p) => p.code === 'Original')!
    const variant = before.variants.find((v) => v.productId === original.id)!

    raw.prepare('update product_variant set is_active = 0 where id = ?').run(variant.id)
    const after = await api.loadDrinkCatalog()
    expect(after.products.some((p) => p.code === 'Original')).toBe(true)
    expect(after.variants.some((v) => v.id === variant.id)).toBe(false)
    expect(after.variants.length).toBe(before.variants.length - 1)
  })
})
