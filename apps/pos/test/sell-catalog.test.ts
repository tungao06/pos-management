import { describe, expect, it } from 'vitest'
import { posErrorCode } from '../src/api/errors'
import { pullCatalog } from '../src/sync/catalog'
import { openConnectedApi } from './helpers/dayo'
import { openTestApi, sellCode } from './helpers/db'

describe('loadSellCatalog (spec 04 §4.4 rule 2)', () => {
  it('groups variants into menus in menuSortOrder with the shop defaults', async () => {
    const t = await openConnectedApi()
    const c = await t.api.loadSellCatalog()
    expect(c.menus.map((m) => m.code)).toEqual(['Thai Tea', 'Matcha Latte', 'Cocoa', 'Pink Milk'])
    expect(c.categories).toEqual(['ชา', 'มัตฉะ', 'โกโก้', 'นม'])
    const pink = c.menus.find((m) => m.code === 'Pink Milk')!
    expect([pink.sizes, pink.sweetnessBySize['16 oz']]).toEqual([['16 oz', '20 oz'], ['100%']])
    expect(c.menus.map((m) => `${m.defaultSize}/${m.defaultSweetness}`)).toEqual(['16 oz/100%', '16 oz/100%', '16 oz/100%', '16 oz/100%'])
    expect(c.menus.find((m) => m.code === 'Cocoa')!.sweetnessBySize['16 oz']).toEqual(['50%', '100%'])
    expect(c).toMatchObject({ catalogVersion: 42, defaultChannelCode: 'store', payments: { cash: true, qr: true }, maxQtyPerLine: 99, bestSellerCodes: [] })
    expect(c.channels.map((x) => x.code)).toEqual(['store', 'grab', 'lineman'])
    expect(c.sizes).toEqual([{ code: '16 oz', label: '16 oz' }, { code: '20 oz', label: '20 oz' }]) // 22 oz is closed
  })
  it('best sellers are the codes with the most cups in the last 7 days (D48 Q3-9)', async () => {
    const t = await openConnectedApi()
    await sellCode(t, [{ code: 'Cocoa', qty: 3 }], { method: 'PROMPTPAY' })
    await sellCode(t, [{ code: 'Pink Milk', sweetness: '100%', qty: 1 }], { method: 'PROMPTPAY' })
    expect((await t.api.loadSellCatalog()).bestSellerCodes).toEqual(['Cocoa', 'Pink Milk'])
  })
  it('without a catalog from dayo the sell screen cannot open', async () => {
    const t = await openTestApi()
    try { await t.api.loadSellCatalog(); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('NO_CATALOG') }
  })

  it('sizes follow catalog.sizes (active, sortOrder) — never a fixed 16/20 list (ADR-0054)', async () => {
    const t = await openConnectedApi()
    const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
    t.mock.bumpCatalog((c) => {
      const cat = c.catalog
      cat.sizes = cat.sizes.map((x) => (x.code === '22 oz' ? { ...x, isActive: true } : x)) // 22 oz, sortOrder 2
      const pink20 = cat.variants.find((v) => v.menuCode === 'Pink Milk' && v.size === '20 oz')!
      cat.variants.push({ ...pink20, size: '22 oz', price: 85 })
    })
    await pullCatalog(ctx)
    expect((await t.api.loadSellCatalog()).menus.find((m) => m.code === 'Pink Milk')!.sizes).toEqual(['16 oz', '20 oz', '22 oz'])
    await sellCode(t, [{ code: 'Pink Milk', size: '22 oz', sweetness: '100%', qty: 1 }], { method: 'PROMPTPAY' }) // now sellable

    t.mock.bumpCatalog((c) => { c.catalog.sizes = c.catalog.sizes.map((x) => (x.code === '16 oz' ? { ...x, sortOrder: 5 } : x)) })
    await pullCatalog(ctx)
    const c = await t.api.loadSellCatalog()
    expect(c.sizes.map((x) => x.code)).toEqual(['20 oz', '22 oz', '16 oz'])
    const pink = c.menus.find((m) => m.code === 'Pink Milk')!
    expect(pink.sizes).toEqual(['20 oz', '22 oz', '16 oz'])
    expect(pink.defaultSize).toBe('16 oz') // settings.defaultSize, the menu has it
    expect(c.menus.find((m) => m.code === 'Cocoa')!.sizes).toEqual(['20 oz', '16 oz']) // no 22 oz variant
  })
  it('a closed size is not offered even if a stale variant is still there; the default falls back to the first size', async () => {
    const t = await openConnectedApi()
    t.mock.bumpCatalog((c) => {
      const cat = c.catalog
      const pink20 = cat.variants.find((v) => v.menuCode === 'Pink Milk' && v.size === '20 oz')!
      cat.variants.push({ ...pink20, size: '22 oz', price: 85 }) // 22 oz stays isActive: false
      cat.sizes = cat.sizes.map((x) => (x.code === '16 oz' ? { ...x, isActive: false } : x))
      for (const v of cat.variants) if (v.menuCode === 'Cocoa') v.categoryLabel = null
    })
    await pullCatalog({ db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() })
    const c = await t.api.loadSellCatalog()
    const pink = c.menus.find((m) => m.code === 'Pink Milk')!
    expect(pink.sizes).toEqual(['20 oz'])
    expect(pink.defaultSize).toBe('20 oz')
    expect(c.categories).toContain('โกโก้') // categoryLabel null → family
    expect(c.menus.find((m) => m.code === 'Cocoa')!.categoryLabel).toBe('โกโก้')
  })
})
