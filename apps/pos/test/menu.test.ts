import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import type { MenuDto } from '../src/api/types'
import { openTestApi } from './helpers/db'

function priceOf(menu: MenuDto, productCode: string, sizeCode: string): number | null {
  const product = menu.products.find((p) => p.code === productCode)!
  const size = menu.sizes.find((z) => z.code === sizeCode)!
  return menu.variants.find((v) => v.productId === product.id && v.sizeId === size.id)!.priceSatang
}

describe('loadMenu', () => {
  it('lists the active catalog in sort order with current store prices and the spec defaults (16 oz, 50%)', async () => {
    const { api } = await openTestApi()
    const menu = await api.loadMenu()
    expect(menu.categories.map((c) => c.name)).toEqual(['ชาไทย', 'ชาเขียว', 'มัทฉะพรีเมียม'])
    expect(menu.products).toHaveLength(24)
    expect(menu.products[0]).toMatchObject({ code: 'Original', nameTh: 'ชาไทยเย็น', nameEn: 'Original' })
    expect(menu.sizes.map((z) => z.code)).toEqual(['16oz', '20oz', '22oz'])
    expect(menu.sweetness.map((x) => x.name)).toEqual(['0%', '25%', '50%', '75%', '100%'])
    expect(menu.variants).toHaveLength(72)
    expect(menu.variants.every((v) => v.priceSatang !== null)).toBe(true)
    expect([priceOf(menu, 'Original', '16oz'), priceOf(menu, 'Original', '20oz'), priceOf(menu, 'Original', '22oz')]).toEqual([4500, 5000, 5500])
    expect(menu.sizes.find((z) => z.id === menu.defaultSizeId)!.code).toBe('16oz')
    expect(menu.sweetness.find((x) => x.id === menu.defaultSweetnessId)!.name).toBe('50%')
    expect(menu.bestSellerProductIds).toEqual([])
  })

  it('uses a new price only from its effective time', async () => {
    const { api, db, clock } = await openTestApi()
    const menu = await api.loadMenu()
    const original = menu.products.find((p) => p.code === 'Original')!
    const v16 = menu.variants.find((v) => v.productId === original.id && v.sizeId === menu.defaultSizeId)!
    const at = '2026-09-17T00:00:00.000Z'
    // price is an R table: version + updated_at (D47 item 8)
    await db.insert(s.price).values({ id: 'p-future', variantId: v16.id, channelId: menu.storeChannelId, priceSatang: 4900, effectiveFrom: '2026-09-18T00:00:00.000Z', createdBy: null, createdAt: at, version: 1, updatedAt: at })
    expect(priceOf(await api.loadMenu(), 'Original', '16oz')).toBe(4500)
    clock.set('2026-09-18T00:00:00.000Z')
    expect(priceOf(await api.loadMenu(), 'Original', '16oz')).toBe(4900)
  })

  it('hides inactive products', async () => {
    const { api, raw } = await openTestApi()
    raw.prepare("update product set is_active = 0 where code = 'Original'").run()
    const menu = await api.loadMenu()
    expect(menu.products).toHaveLength(23)
    expect(menu.products.some((p) => p.code === 'Original')).toBe(false)
  })
})
