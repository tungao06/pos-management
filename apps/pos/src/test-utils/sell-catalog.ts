import rich from '@dayo/contracts/fixtures/pos-test/e1-catalog-rich.json' with { type: 'json' }
import { PosCatalogResponse } from '@dayo/contracts'
import promoRules from '@dayo/contracts/fixtures/dayo-api/e1-catalog-changed-promo-rules.json' with { type: 'json' }
import { saleSettingsOf } from '@dayo/dayo-pricing'
import { toPricingCatalog } from '@dayo/domain'
import type { SellCatalogDto } from '../api/types'

/** A SellCatalogDto built the way loadSellCatalog builds it, from the POS test catalog — for screen tests only. */
export function testSellCatalog(): SellCatalogDto {
  const d = PosCatalogResponse.parse(rich).data
  if (!d.changed) throw new Error('rich catalog must be changed:true')
  const catalog = toPricingCatalog(d.catalog)
  const set = saleSettingsOf(catalog)
  const codes = [...new Set(catalog.variants.map((v) => v.menuCode))]
  return {
    catalogVersion: d.catalog_version, catalog, categories: ['ชา', 'มัตฉะ', 'โกโก้', 'นม'], channels: catalog.channels.map((c) => ({ code: c.code, name: c.name })),
    defaultChannelCode: 'store', payments: { cash: true, qr: true }, maxQtyPerLine: 99, bestSellerCodes: [],
    sizes: catalog.sizes.filter((z) => z.isActive).sort((a, b) => a.sortOrder - b.sortOrder).map((z) => ({ code: z.code, label: z.label })),
    menus: codes.map((code, i) => {
      const vs = catalog.variants.filter((v) => v.menuCode === code)
      // ADR-0054: sizes come from catalog.sizes (active, sortOrder), never a fixed '16 oz'/'20 oz' list
      const sizes = catalog.sizes.filter((z) => z.isActive && vs.some((v) => v.size === z.code)).sort((a, b) => a.sortOrder - b.sortOrder).map((z) => z.code)
      const defaultSize = sizes.includes(set.defaultSize) ? set.defaultSize : sizes[0]!
      return { code, nameTh: vs[0]!.menuNameTh, categoryLabel: vs[0]!.categoryLabel ?? vs[0]!.family, sortOrder: vs[0]!.menuSortOrder ?? i, isMatcha: vs[0]!.isMatcha, sizes,
        sweetnessBySize: Object.fromEntries(sizes.map((z) => [z, vs.filter((v) => v.size === z).map((v) => v.sweetness)])),
        defaultSize, defaultSweetness: vs.some((v) => v.sweetness === '100%') ? '100%' : vs[0]!.sweetness }
    }),
  }
}

/** ids of the plan 10 rule fixture: ชงผิด ฟรีแก้วใหม่ (เลือกเอง) — 100% any cup · ลดชาไทย 5 บาท (เลือกเอง). */
export const MANUAL_FREE_ID = '5c5c5c5c-0000-4000-8000-000000000004'
export const MANUAL_FIVE_ID = '5c5c5c5c-0000-4000-8000-000000000005'

/** testSellCatalog() plus the promotions and groups of the plan 10 rule fixture (two manual promotions) — screens only. */
export function promoSellCatalog(): SellCatalogDto {
  const base = testSellCatalog()
  const e1 = PosCatalogResponse.parse((promoRules as { response: { body: unknown } }).response.body).data
  if (!e1.changed) throw new Error('promo fixture must be changed:true')
  const withRules = toPricingCatalog(e1.catalog)
  return { ...base, catalog: { ...base.catalog, promotions: withRules.promotions, promotionGroups: withRules.promotionGroups ?? [] } }
}
