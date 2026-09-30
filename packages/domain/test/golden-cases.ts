/**
 * dayo's golden promo-rule cases (packages/dayo-pricing/golden — vendored byte for byte with dayo's own load.ts, plan 10
 * R1) as cases of the tablet's sale path. The catalog and draft of each case are built by dayo's load.ts exactly as
 * dayo's own golden test builds them — no second converter here.
 *
 * load.ts is imported at runtime through a computed path: a literal import would pull dayo's vendored source into this
 * package's type-check, which compiles under flags dayo's code does not (exactOptionalPropertyTypes — T1 ruling: consumers
 * type-check the engine through its .d.ts only). `GoldenLoad` below types the six functions used; a changed signature in
 * a re-vendor fails the golden tests at runtime.
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { OrderCatalog, OrderDraft, Promotion, PromotionGroup } from '@dayo/dayo-pricing'
import { ParityDraft } from '@dayo/contracts'
import type { PosOrderCatalog } from '../src/index.js'
import type { GoldenExpected } from './parity-view.js'

type FixtureDraft = { saleTime?: string; exhaustedPromotions?: unknown[] }
type FixtureCase = { name: string; draft: FixtureDraft; expected?: GoldenExpected }
type PromoRow = { priority: number; code: string | null; name: string }
type GoldenFile = { form: 'legacy' | 'rule'; promotions: PromoRow[]; groups?: PromotionGroup[]; cases: FixtureCase[] }
type GoldenLoad = {
  readJson: <T>(name: string) => T
  fixtureFileNames: (prefix: string) => string[]
  catalogFromPayload: (payload: unknown) => Omit<OrderCatalog, 'promotions'>
  sqlPromoOrder: <T extends PromoRow>(rows: T[]) => T[]
  legacyPromotion: (row: PromoRow) => Promotion
  rulePromotion: (row: PromoRow) => Promotion
  toOrderDraft: (draft: FixtureDraft) => OrderDraft
}

const LOAD = fileURLToPath(new URL('../../dayo-pricing/golden/test/fixtures/promo-rules/load.ts', import.meta.url))
const load = (await import(/* @vite-ignore */ pathToFileURL(LOAD).href)) as GoldenLoad

export type GoldenCase = {
  /** `<file> › <case name>` — unique across the golden set. */
  key: string; file: string; form: 'legacy' | 'rule'; name: string
  /** dayo's OrderDraft of the case (load.ts toOrderDraft: promotion ids = names), read by the contract's parity draft shape. */
  draft: ParityDraft
  /** The same draft as dayo's engine takes it — for the engine layer only. */
  orderDraft: OrderDraft
  /** load.ts catalog of the file: legacy files in the old catalog form (kind + params), rules-* with their groups. */
  catalog: PosOrderCatalog
  expected: GoldenExpected
}

export const GOLDEN_FILES: readonly string[] = [...load.fixtureFileNames('legacy-'), ...load.fixtureFileNames('rules-')]

/** Every golden case that has `expected` (all of them at the pin — dayo-pricing's golden.test.ts counts that). */
export function goldenCases(): GoldenCase[] {
  const base = load.catalogFromPayload(load.readJson<unknown>('catalog.json'))
  return GOLDEN_FILES.flatMap((file) => {
    const f = load.readJson<GoldenFile>(file)
    const ordered = load.sqlPromoOrder(f.promotions)
    const catalog: PosOrderCatalog = f.form === 'legacy'
      ? { ...base, promotions: ordered.map(load.legacyPromotion) }
      : { ...base, promotions: ordered.map(load.rulePromotion), promotionGroups: f.groups ?? [] }
    return f.cases.flatMap((c) => {
      if (c.expected === undefined) return []
      const orderDraft = load.toOrderDraft(c.draft)
      return [{ key: `${file} › ${c.name}`, file, form: f.form, name: c.name, draft: ParityDraft.parse(orderDraft), orderDraft, catalog, expected: c.expected }]
    })
  })
}
