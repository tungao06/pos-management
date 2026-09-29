// packages/dayo-mock/src/control.ts — the /__mock/* test-control routes of server.ts (e2e). No node:* imports, never shipped.
import type { CentralOrder, CupSize } from '@dayo/contracts'
import type { PromoRulesOption } from './promo-rules.js'
import { mergeVariants, type CatalogPromotion, type CatalogVariant, type MockDayo, type MockMode, type MockOverride, type PosOrderEdit, type PromotionGroup } from './state.js'

type EditBody = { pos_order_id?: string; kind: PosOrderEdit['kind']; reason: string; edited_at?: string; edited_by_name?: string | null; totals?: PosOrderEdit['totals'] }

export async function mockControl(mock: MockDayo, path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const ok = { status: 200, body: { ok: true } }
  switch (path) {
    case '/__mock/reset': mock.reset(); return ok
    case '/__mock/mode': mock.setMode((body as { mode: MockMode }).mode); return ok
    case '/__mock/now': mock.setNow((body as { iso: string | null }).iso); return ok
    case '/__mock/scopes': mock.setScopes((body as { scopes: string[] }).scopes); return ok
    case '/__mock/override': mock.override(body as MockOverride); return ok
    case '/__mock/bump-catalog': { // sizes: replaces the whole list · variants: merged by (menuCode, size, sweetness)
      const b = body as { sizes?: CupSize[]; variants?: CatalogVariant[] } | null
      const sizes = b?.sizes
      const variants = b?.variants
      return {
        status: 200,
        body: {
          catalog_version: mock.bumpCatalog((c) => {
            if (sizes !== undefined) c.catalog.sizes = structuredClone(sizes)
            if (variants !== undefined) mergeVariants(c, variants)
          }),
        },
      }
    }
    case '/__mock/close-promotion': {
      const b = body as { id: string; at: string }
      return { status: 200, body: { catalog_version: mock.closePromotion(b.id, b.at) } }
    }
    case '/__mock/promotions': { // plan 10: {promotions, groups?} as the owner saves them on dayo's web (rules; dayo derives the old shape)
      const b = body as { promotions: CatalogPromotion[]; groups?: PromotionGroup[] }
      return { status: 200, body: { catalog_version: mock.setPromotions(b.promotions, b.groups) } }
    }
    case '/__mock/exhaust': mock.exhaust((body as { id: string }).id, (body as { scope: 'total' | 'day' }).scope); return ok // plan 10: a promotion over its usage limit
    case '/__mock/promo-rules': { // plan 10: {versions, manualFields} — the promotion-rule release of dayo
      return { status: 200, body: { catalog_version: mock.setPromoRules(body as PromoRulesOption) } }
    }
    case '/__mock/edit-pos-order': { // no pos_order_id = the latest POS bill the mock accepted
      const b = body as EditBody
      const id = b.pos_order_id ?? mock.orders().at(-1)?.posOrderId
      if (id === undefined) return { status: 404, body: { ok: false } }
      mock.editPosOrder(id, {
        kind: b.kind, reason: b.reason, ...(b.edited_at === undefined ? {} : { editedAt: b.edited_at }),
        ...(b.edited_by_name === undefined ? {} : { editedByName: b.edited_by_name }), ...(b.totals === undefined ? {} : { totals: b.totals }),
      })
      return ok
    }
    case '/__mock/seed-orders': mock.seedCentralOrders(body as CentralOrder[]); return ok
    case '/__mock/block3': { // {on, phase2?}: phase 1 on/off · phase2 true/false switches dayo phase 2 too (preflight P3)
      const b = body as { on: boolean; phase2?: boolean }
      let version = mock.setBlock3(b.on)
      if (b.phase2 !== undefined) version = mock.setBlock3Phase2(b.phase2)
      return { status: 200, body: { catalog_version: version } }
    }
    case '/__mock/preload-z': mock.preloadZ(body as { zNo: number; hash: string; countedAt: string }); return ok
    case '/__mock/off-catalog-cap': mock.setOffCatalogCap((body as { baht: number }).baht); return ok       // D103 (phase 2)
    case '/__mock/block3-live-from': mock.setBlock3LiveFrom((body as { date: string | null }).date); return ok // D100
    case '/__mock/state': return { status: 200, body: { orders: mock.orders(), requests: mock.requests(), shifts: mock.shifts(), zReports: mock.zReports(), conflicts: mock.conflicts(), rejections: mock.rejections() } }
    default: return { status: 404, body: { ok: false } }
  }
}
