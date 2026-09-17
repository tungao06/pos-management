import { roundDivBig } from '../money.js'

export type ItemKind = 'raw' | 'prepared' | 'packaging_set'
export type CatalogItem = { id: string; kind: ItemKind; isTracked: boolean; standardCostUsat: number }
export type BomLine = { itemId: string; qtyMilli: number }
export type Bom = { itemId: string; yieldMilli: number; lines: BomLine[] }
export type Catalog = { items: ReadonlyMap<string, CatalogItem>; boms: ReadonlyMap<string, Bom> }

export const MAX_BOM_DEPTH = 10

export function buildCatalog(items: readonly CatalogItem[], boms: readonly Bom[]): Catalog {
  return {
    items: new Map(items.map((i) => [i.id, i])),
    boms: new Map(boms.map((b) => [b.itemId, b])),
  }
}

export function requireItem(catalog: Catalog, id: string): CatalogItem {
  const item = catalog.items.get(id)
  if (!item) throw new Error(`unknown item ${id}`)
  return item
}

export function requireBom(catalog: Catalog, id: string): Bom {
  const bom = catalog.boms.get(id)
  if (!bom) throw new Error(`item ${id} has no BOM`)
  if (bom.yieldMilli <= 0) throw new Error(`BOM of ${id} has non-positive yield`)
  return bom
}

/** Standard (pre-purchase) cost per use-unit in usat. Prepared/packaging items roll up through their BOM regardless of tracking. */
export function standardUnitCostUsat(itemId: string, catalog: Catalog, depth = 0): number {
  if (depth > MAX_BOM_DEPTH) throw new Error(`BOM cycle or depth exceeded at ${itemId}`)
  const item = requireItem(catalog, itemId)
  if (item.kind === 'raw') return item.standardCostUsat
  const bom = requireBom(catalog, itemId)
  let total = 0n // milli × usat
  for (const line of bom.lines) {
    total += BigInt(line.qtyMilli) * BigInt(standardUnitCostUsat(line.itemId, catalog, depth + 1))
  }
  return Number(roundDivBig(total, BigInt(bom.yieldMilli)))
}
