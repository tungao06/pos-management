import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { computeOrder } from '@dayo/dayo-pricing'
import { ParityFile } from '@dayo/contracts'
import { loadRichCatalog } from '@dayo/contracts/fixture-files'
import { CartError, cartFromOrderDraft, toOrderDraft, toPricingCatalog, withZeroCosts } from '../src/index.js'
import { PARITY_CASES } from '../test/fixtures/parity-cases.js'

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url))
const e1 = loadRichCatalog()
const catalog = toPricingCatalog(e1.catalog)
const vendor = JSON.parse(readFileSync(here('../../dayo-pricing/VENDOR.json'), 'utf8')) as { commit: string; files: Record<string, string> }
const r2 = (n: number): number => Math.round(n * 100) / 100
const REFUSED = { ok: false, itemsSubtotal: 0, itemsDiscount: 0, billDiscountAmount: 0, totalAmount: 0, channelFeeAmount: 0, lines: [], promotionsApplied: [] }

// dayo's case shape (scripts/export-pos-parity.ts): `spec` names the case, `note` says what it checks
const cases = PARITY_CASES.map(({ id, spec: specRef, draft }) => {
  const head = { spec: id, note: `spec 04 ${specRef}` }
  let parsed
  try { parsed = cartFromOrderDraft(draft, catalog) } catch (e) { if (e instanceof CartError) return { ...head, draft, expected: REFUSED }; throw e }
  const q = computeOrder(toOrderDraft(parsed.cart, catalog, parsed.soldAt), withZeroCosts(catalog))
  return { ...head, draft, expected: {
    ok: q.ok, itemsSubtotal: r2(q.itemsSubtotal), itemsDiscount: r2(q.itemsDiscount), billDiscountAmount: r2(q.billDiscountAmount), totalAmount: r2(q.totalAmount), channelFeeAmount: r2(q.channelFeeAmount),
    lines: q.lines.map((l) => ({ lineNo: l.lineNo, unitPrice: r2(l.unitPrice), discountPerCup: r2(l.discountPerCup), lineTotal: r2(l.lineTotal) })),
    promotionsApplied: q.promotionsApplied.map((p) => ({ promotionId: p.promotionId, discountAmount: r2(p.discountAmount) })),
  } }
})
const out = ParityFile.parse({ source: 'pos-seed: vendored computeOrder — NOT dayo quote_order', dayo_commit: vendor.commit, pricing_files_sha256: vendor.files, generated_at: new Date(0).toISOString(), catalog_version: e1.catalog_version, catalog: e1.catalog, cases })
writeFileSync(here('../../dayo-pricing/fixtures/pos-parity.seed.json'), `${JSON.stringify(out, null, 2)}\n`)
console.log(`wrote ${cases.length} seed cases`)
