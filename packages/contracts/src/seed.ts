import { z } from 'zod'
import { ItemKind, UseUnit } from './enums.js'

const int = z.number().int()
const nonneg = int.nonnegative()
const pos = int.positive()
const code = z.string().min(1)

export const SeedCategory = z.object({ code, name: z.string().min(1), sort: nonneg })
export const SeedSize = z.object({ code, name: z.string().min(1), sort: nonneg, packagingItemCode: code })
export const SeedSweetness = z.object({ code, name: z.string().min(1), sort: nonneg, isDefault: z.boolean() })
export const SeedChannel = z.object({ code, name: z.string().min(1), commissionBp: nonneg })
export const SeedItem = z.object({
  code,
  name: z.string().min(1),
  kind: ItemKind,
  category: z.string().min(1),
  useUnit: UseUnit,
  isTracked: z.boolean(),
  reorderPointMilli: nonneg,
  standardCostUsat: nonneg,
  shelfLifeHours: pos.nullable(),
  note: z.string().nullable(),
})
export const SeedPurchaseUnit = z.object({ itemCode: code, name: z.string().min(1), qtyPerUnitMilli: pos, isDefault: z.boolean() })
export const SeedBom = z.object({ itemCode: code, yieldMilli: pos, lines: z.array(z.object({ itemCode: code, qtyMilli: pos })).min(1) })
export const SeedProduct = z.object({ code, nameTh: z.string().min(1), nameEn: z.string().min(1), categoryCode: code, sort: nonneg, prepGroup: z.string().nullable() })
export const SeedVariant = z.object({ productCode: code, sizeCode: code, sku: code })
export const SeedPrice = z.object({ productCode: code, sizeCode: code, channelCode: code, priceSatang: nonneg })
export const SeedRecipe = z.object({
  productCode: code,
  sizeCode: code,
  sweetnessCode: code,
  lines: z.array(z.object({ itemCode: code, qtyMilli: pos })).min(1),
  excelCostSatang: nonneg,
  excelLiquidMilli: nonneg,
})
export const SeedEquipment = z.object({
  code,
  name: z.string().min(1),
  purchasedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  priceSatang: nonneg,
  qty: pos,
  supplier: z.string().nullable(),
  lifeYears: z.number().positive().nullable(),
  condition: z.string().nullable(),
  owner: z.string().nullable(),
  note: z.string().nullable(),
})

export const SeedSchema = z
  .object({
    categories: z.array(SeedCategory).min(1),
    sizes: z.array(SeedSize).min(1),
    sweetness: z.array(SeedSweetness).min(1),
    channels: z.array(SeedChannel).min(1),
    items: z.array(SeedItem).min(1),
    purchaseUnits: z.array(SeedPurchaseUnit),
    boms: z.array(SeedBom),
    products: z.array(SeedProduct).min(1),
    variants: z.array(SeedVariant).min(1),
    prices: z.array(SeedPrice).min(1),
    recipes: z.array(SeedRecipe).min(1),
    equipment: z.array(SeedEquipment),
  })
  .superRefine((s, ctx) => {
    const items = new Set(s.items.map((i) => i.code))
    const products = new Set(s.products.map((p) => p.code))
    const sizes = new Set(s.sizes.map((x) => x.code))
    const sweet = new Set(s.sweetness.map((x) => x.code))
    const channels = new Set(s.channels.map((x) => x.code))
    const cats = new Set(s.categories.map((x) => x.code))
    const need = (ok: boolean, path: (string | number)[], msg: string) => { if (!ok) ctx.addIssue({ code: 'custom', path, message: msg }) }
    s.sizes.forEach((x, i) => need(items.has(x.packagingItemCode), ['sizes', i], `unknown item ${x.packagingItemCode}`))
    s.purchaseUnits.forEach((x, i) => need(items.has(x.itemCode), ['purchaseUnits', i], `unknown item ${x.itemCode}`))
    s.boms.forEach((b, i) => {
      need(items.has(b.itemCode), ['boms', i], `unknown item ${b.itemCode}`)
      b.lines.forEach((l, j) => need(items.has(l.itemCode), ['boms', i, 'lines', j], `unknown item ${l.itemCode}`))
    })
    s.products.forEach((p, i) => need(cats.has(p.categoryCode), ['products', i], `unknown category ${p.categoryCode}`))
    s.variants.forEach((v, i) => need(products.has(v.productCode) && sizes.has(v.sizeCode), ['variants', i], `unknown product/size ${v.productCode}/${v.sizeCode}`))
    s.prices.forEach((p, i) => need(products.has(p.productCode) && sizes.has(p.sizeCode) && channels.has(p.channelCode), ['prices', i], `unknown ref in price ${p.productCode}`))
    s.recipes.forEach((r, i) => {
      need(products.has(r.productCode) && sizes.has(r.sizeCode) && sweet.has(r.sweetnessCode), ['recipes', i], `unknown ref in recipe ${r.productCode}`)
      r.lines.forEach((l, j) => need(items.has(l.itemCode), ['recipes', i, 'lines', j], `unknown item ${l.itemCode}`))
    })
  })

export type Seed = z.infer<typeof SeedSchema>

export function parseSeed(json: unknown): Seed {
  const r = SeedSchema.safeParse(json)
  if (!r.success) throw new Error(`invalid seed: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  return r.data
}
