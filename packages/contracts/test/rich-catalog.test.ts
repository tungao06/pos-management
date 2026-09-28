import { expect, it } from 'vitest'
import { loadRichCatalog } from '../src/dayo-fixture-files.js'

it('the POS test catalog parses and covers what block-2 tests need', () => {
  const c = loadRichCatalog()
  expect(c.catalog.variants).toHaveLength(22)
  expect(c.catalog.channels.map((x) => x.code)).toEqual(['store', 'grab', 'lineman'])
  expect(c.catalog.promotions.map((p) => p.kind).sort()).toEqual(['bill_discount', 'bundle', 'buy_n_get_m', 'item_discount', 'item_discount'])
  expect(c.staff).toHaveLength(6)
  expect(JSON.stringify(c)).not.toContain('costPerUseUnit') // spec §4.4 rule 1
})
