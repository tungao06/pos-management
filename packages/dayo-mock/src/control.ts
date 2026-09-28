// packages/dayo-mock/src/control.ts — the /__mock/* test-control routes of server.ts (e2e). No node:* imports, never shipped.
import type { CentralOrder, CupSize } from '@dayo/contracts'
import { mergeVariants, type CatalogVariant, type MockDayo, type MockMode, type MockOverride, type PosOrderEdit } from './state.js'

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
    case '/__mock/state': return { status: 200, body: { orders: mock.orders(), requests: mock.requests() } }
    default: return { status: 404, body: { ok: false } }
  }
}
