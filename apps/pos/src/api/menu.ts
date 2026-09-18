import { and, asc, desc, eq, gte, sql } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { priceFor } from '@dayo/domain'
import { addDaysToDate, bangkokDate } from '../lib/clock'
import { currentOpenShift, localDeviceId } from './bootstrap'
import type { ApiDeps } from './deps'
import { PosError } from './errors'
import type { MenuDto } from './types'

export const STORE_CHANNEL_CODE = 'STORE' // phase 1 sells in-store only (spec §3.2)
export const DEFAULT_SIZE_CODE = '16oz' // spec §5, D27
export const BEST_SELLER_DAYS = 7 // (D48 Q3-9)
export const BEST_SELLER_LIMIT = 8 // (D48 Q3-9)

export async function requireStoreChannelId(db: RemoteDb): Promise<string> {
  const row = await db.select().from(s.channel).where(eq(s.channel.code, STORE_CHANNEL_CODE)).get()
  if (!row) throw new PosError('NEEDS_SETUP', `channel ${STORE_CHANNEL_CODE} is missing from the catalog`)
  return row.id
}

export async function loadMenu(db: RemoteDb, deps: ApiDeps): Promise<MenuDto> {
  const at = deps.now()
  const storeChannelId = await requireStoreChannelId(db)

  const categories = (await db.select().from(s.category).where(eq(s.category.isActive, true)).orderBy(asc(s.category.sort)).all()).map((c) => ({ id: c.id, code: c.code, name: c.name }))
  const products = (await db.select().from(s.product).where(eq(s.product.isActive, true)).orderBy(asc(s.product.sort)).all()).map((p) => ({ id: p.id, code: p.code, nameTh: p.nameTh, nameEn: p.nameEn, categoryId: p.categoryId }))
  const sizes = (await db.select().from(s.size).orderBy(asc(s.size.sort)).all()).map((z) => ({ id: z.id, code: z.code, name: z.name }))
  const sweetness = (await db.select().from(s.sweetnessLevel).orderBy(asc(s.sweetnessLevel.sort)).all()).map((x) => ({ id: x.id, code: x.code, name: x.name, isDefault: x.isDefault }))

  const prices = (await db.select().from(s.price).where(eq(s.price.channelId, storeChannelId)).all()).map((p) => ({ variantId: p.variantId, channelId: p.channelId, priceSatang: p.priceSatang, effectiveFrom: p.effectiveFrom }))
  const variants = (await db.select().from(s.productVariant).where(eq(s.productVariant.isActive, true)).all()).map((v) => ({
    id: v.id,
    productId: v.productId,
    sizeId: v.sizeId,
    priceSatang: priceFor(prices, v.id, storeChannelId, at)?.priceSatang ?? null,
  }))

  const defaultSize = sizes.find((z) => z.code === DEFAULT_SIZE_CODE) ?? sizes[0]
  const defaultSweetness = sweetness.find((x) => x.isDefault) ?? sweetness[0]
  if (!defaultSize || !defaultSweetness) throw new PosError('NEEDS_SETUP', 'catalog has no sizes or sweetness levels')

  // M6: anchor on the open shift's business date (not the wall clock) so a post-midnight sale before the shift
  // closes still counts toward "today"; falls back to the wall clock when there is no device yet or no shift is
  // open (localDeviceId does not throw, unlike requireDevice — loadMenu is callable before setup, e.g. in tests).
  // Window is the last 7 calendar days, not the last 7 business days with sales (D50 Q3-25).
  const deviceId = await localDeviceId(db)
  const openShift = deviceId === null ? null : await currentOpenShift(db, deviceId)
  const anchorDate = openShift?.businessDate ?? bangkokDate(at)
  const since = addDaysToDate(anchorDate, -(BEST_SELLER_DAYS - 1))
  const cups = sql<number>`sum(${s.orderLine.qty})`
  const best = await db
    .select({ productId: s.productVariant.productId, cups })
    .from(s.orderLine)
    .innerJoin(s.order, eq(s.orderLine.orderId, s.order.id))
    .innerJoin(s.productVariant, eq(s.orderLine.variantId, s.productVariant.id))
    .where(and(eq(s.order.status, 'paid'), gte(s.order.businessDate, since)))
    .groupBy(s.productVariant.productId)
    .orderBy(desc(cups))
    .limit(BEST_SELLER_LIMIT)
    .all()

  return {
    storeChannelId,
    categories,
    products,
    sizes,
    sweetness,
    variants,
    defaultSizeId: defaultSize.id,
    defaultSweetnessId: defaultSweetness.id,
    bestSellerProductIds: best.map((b) => b.productId),
  }
}
