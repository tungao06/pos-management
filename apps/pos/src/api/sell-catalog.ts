import { and, eq, gte, sql } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { bangkokDateOf } from '@dayo/contracts'
import { saleSettingsOf, type Size, type Sweetness } from '@dayo/dayo-pricing'
import type { PosOrderCatalog, PosVariant } from '@dayo/domain'
import { readCatalog } from '../sync/catalog'
import { currentOpenShift, localDeviceId } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import { PAYMENT_CODE, type SellCatalogDto, type SellMenuDto } from './types'

const SWEETNESS_ORDER: readonly Sweetness[] = ['0%', '25%', '50%', '75%', '100%']
const MAX_QTY_CAP = 999 // E2 line qty ≤ 999 (spec §4.5), whatever the shop setting says
const BEST_SELLER_DAYS = 7
const BEST_SELLER_COUNT = 8

/** YYYY-MM-DD minus `days` whole days (calendar arithmetic on the date only). */
function minusDays(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00.000Z`) - days * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Variants grouped into menus (spec 04 §4.4 rule 2). Sizes are the ACTIVE entries of catalog.sizes in their sortOrder
 * that the menu has a variant of (ADR-0054 — never a fixed 16/20 list); a menu with no sellable size is left out.
 */
function buildMenus(c: PosOrderCatalog): SellMenuDto[] {
  const set = saleSettingsOf(c)
  const sizeOrder = c.sizes.filter((x) => x.isActive).sort((a, b) => a.sortOrder - b.sortOrder).map((x) => x.code)
  const byCode = new Map<string, PosVariant[]>()
  for (const v of c.variants) {
    const list = byCode.get(v.menuCode)
    if (list === undefined) byCode.set(v.menuCode, [v])
    else list.push(v)
  }
  const menus: SellMenuDto[] = []
  for (const [code, variants] of byCode) {
    const first = variants[0]!
    const sizes = sizeOrder.filter((size) => variants.some((v) => v.size === size))
    if (sizes.length === 0) continue
    const sweetnessBySize: Partial<Record<Size, Sweetness[]>> = {}
    for (const size of sizes) sweetnessBySize[size] = SWEETNESS_ORDER.filter((w) => variants.some((v) => v.size === size && v.sweetness === w))
    const defaultSize = sizes.includes(set.defaultSize) ? set.defaultSize : sizes[0]!
    const sweets = sweetnessBySize[defaultSize]!
    menus.push({
      code, nameTh: first.menuNameTh, categoryLabel: first.categoryLabel ?? first.family, sortOrder: first.menuSortOrder,
      isMatcha: variants.some((v) => v.isMatcha), sizes, sweetnessBySize, defaultSize,
      defaultSweetness: sweets.includes(set.defaultSweetness) ? set.defaultSweetness : sweets[0]!,
    })
  }
  return menus.sort((a, b) => a.sortOrder - b.sortOrder || a.nameTh.localeCompare(b.nameTh, 'th') || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
}

/** D48 Q3-9 · D50 Q3-25: menu codes by cups sold in paid bills of the last 7 business days, only codes still on sale. */
async function bestSellerCodes(db: RemoteDb, deps: ApiDeps, onSale: ReadonlySet<string>): Promise<string[]> {
  const deviceId = await localDeviceId(db)
  const shift = deviceId === null ? null : await currentOpenShift(db, deviceId)
  const since = minusDays(shift?.businessDate ?? bangkokDateOf(deps.now()), BEST_SELLER_DAYS - 1)
  const cups = sql<number>`sum(${s.orderItem.qty})`
  const rows = await db
    .select({ code: s.orderItem.menuCode, cups })
    .from(s.orderItem)
    .innerJoin(s.order, eq(s.order.id, s.orderItem.orderId))
    .where(and(eq(s.order.status, 'paid'), gte(s.order.businessDate, since)))
    .groupBy(s.orderItem.menuCode)
    .orderBy(sql`2 desc`, s.orderItem.menuCode)
    .all()
  return rows.map((r) => r.code).filter((code) => onSale.has(code)).slice(0, BEST_SELLER_COUNT)
}

/** The sell screen's catalog (spec 04 §4.4): dayo's E1 copy on this tablet, grouped for the screen. Writes nothing. */
export async function loadSellCatalog(db: RemoteDb, deps: ApiDeps): Promise<SellCatalogDto> {
  const stored = await readCatalog(db)
  if (stored === null) throw new PosError('NO_CATALOG', 'no catalog from dayo yet')
  const c = stored.catalog
  const set = saleSettingsOf(c)
  const menus = buildMenus(c)
  const channels = c.channels.map((x) => ({ code: x.code, name: x.name }))
  return {
    catalogVersion: stored.catalogVersion,
    catalog: c,
    sizes: c.sizes.filter((x) => x.isActive).sort((a, b) => a.sortOrder - b.sortOrder).map((x) => ({ code: x.code, label: x.label })),
    menus,
    categories: [...new Set(menus.map((m) => m.categoryLabel))],
    channels,
    defaultChannelCode: channels.some((x) => x.code === set.defaultChannelCode) ? set.defaultChannelCode : (channels[0]?.code ?? set.defaultChannelCode),
    payments: { cash: c.paymentMethods.some((p) => p.code === PAYMENT_CODE.CASH), qr: c.paymentMethods.some((p) => p.code === PAYMENT_CODE.PROMPTPAY) },
    maxQtyPerLine: Math.min(set.maxQtyPerLine, MAX_QTY_CAP),
    bestSellerCodes: await bestSellerCodes(db, deps, new Set(menus.map((m) => m.code))),
  }
}
