import { asc, eq } from 'drizzle-orm'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { PosError } from './errors'
import type { DrinkCatalogDto } from './types'

/** Same default size AdjustScreen's drink picker starts on (spec §5, D27) — used only to pick `defaultSizeId`. */
const DEFAULT_SIZE_CODE = '16oz'

/**
 * Products/sizes/sweetness/variants for AdjustScreen's "เป็นแก้ว (ตามสูตร)" picker (spec §5 · Q4-8): active only
 * (M-11 — a drink line can never name a product/variant `adjustStock` would refuse). No price or channel: block 2
 * prices bills from dayo, but stock-out by drink still explodes the LOCAL recipe (recipe/BOM never moved to dayo).
 */
export async function loadDrinkCatalog(db: RemoteDb): Promise<DrinkCatalogDto> {
  const products = (await db.select().from(s.product).where(eq(s.product.isActive, true)).orderBy(asc(s.product.sort)).all()).map((p) => ({ id: p.id, code: p.code, nameTh: p.nameTh }))
  const sizeRows = await db.select().from(s.size).orderBy(asc(s.size.sort)).all()
  const sweetRows = await db.select().from(s.sweetnessLevel).orderBy(asc(s.sweetnessLevel.sort)).all()
  const variants = (await db.select().from(s.productVariant).where(eq(s.productVariant.isActive, true)).all()).map((v) => ({ id: v.id, productId: v.productId, sizeId: v.sizeId }))

  const defaultSize = sizeRows.find((z) => z.code === DEFAULT_SIZE_CODE) ?? sizeRows[0]
  const defaultSweetness = sweetRows.find((x) => x.isDefault) ?? sweetRows[0]
  if (!defaultSize || !defaultSweetness) throw new PosError('NEEDS_SETUP', 'catalog has no sizes or sweetness levels')

  return {
    products,
    sizes: sizeRows.map((z) => ({ id: z.id, name: z.name })),
    sweetness: sweetRows.map((x) => ({ id: x.id, name: x.name })),
    variants,
    defaultSizeId: defaultSize.id,
    defaultSweetnessId: defaultSweetness.id,
  }
}
