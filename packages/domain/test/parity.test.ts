import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ParityFile, type ParityCase } from '@dayo/contracts'
import { CartError, edgeBahtToSatang, toPricingCatalog, type CartErrorCode } from '../src/index.js'
import { priceParityCase } from '../src/parity-support.js'

const at = (p: string): string => fileURLToPath(new URL(p, import.meta.url))
/** dayo's own export (scripts/export-pos-parity.ts), copied verbatim — the block-2 gate. */
const REAL = at('../../dayo-pricing/fixtures/pos-parity.json')
/** POS seed (scripts/gen-parity-seed.ts) on the POS test catalog — a wrapper check only. */
const SEED = at('../../dayo-pricing/fixtures/pos-parity.seed.json')
const vendor = JSON.parse(readFileSync(at('../../dayo-pricing/VENDOR.json'), 'utf8')) as { files: Record<string, string> }
const vendoredText = (dayoPath: string): string => readFileSync(at(`../../dayo-pricing/src/vendor/${dayoPath.split('/').pop()!}`), 'utf8').replace(/\r\n/g, '\n')
const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

/**
 * Cases of dayo's export whose draft the tablet never builds: dayo prices them with a warning, the tablet refuses them
 * before charging (it never prices a different bill than it sends — spec §4.5, DY422). Each entry is the refusal the
 * tablet must give, with its reason, and needs the head's OK.
 */
const TABLET_REFUSES = new Map<string, { code: CartErrorCode; why: string }>([
  ['9a', { code: 'QTY_OUT_OF_RANGE', why: 'qty 150 > maxQtyPerLine 99: dayo clamps to 99 with a warning; the tablet refuses rather than charge 99 cups for 150' }],
  ['9b', { code: 'CART_TOO_LARGE', why: '51 lines: dayo prices with a DY422 warning and its API then refuses the bill; the tablet refuses first' }],
])

const title = (c: ParityCase): string => (c.note === undefined ? c.spec : `${c.spec} — ${c.note}`)

function paritySuite(file: string, isReal: boolean, expectedCases: number): void {
  const parity = ParityFile.parse(JSON.parse(readFileSync(file, 'utf8')))
  const catalog = toPricingCatalog(parity.catalog)
  const noTime = parity.cases.filter((c) => c.draft.saleTime === undefined)
  const refuses = isReal ? TABLET_REFUSES : new Map<string, { code: CartErrorCode; why: string }>()

  describe(isReal
    ? `parity layer C (spec 04 §5.2) — dayo export ${parity.dayo_commit.slice(0, 7)}: POS wrapper vs dayo's real SQL pricing (api_pos_catalog + quote_order) on dayo's sample catalog · ${noTime.length} of ${parity.cases.length} cases without saleTime — time-bound promos not exercised${noTime.length > 0 ? ` (${noTime.map((c) => c.spec).join(' ')})` : ''}`
    : 'parity layer C (spec 04 §5.2) — POS SEED: wrapper check only, NOT the block-2 gate', () => {
    it('the fixture was made with the vendored pricing version (same text: dayo\'s export may hash its CRLF checkout, the vendored rule hashes LF)', () => {
      expect(Object.keys(parity.pricing_files_sha256).sort()).toEqual(Object.keys(vendor.files).sort())
      for (const [path, lfHash] of Object.entries(vendor.files)) {
        const text = vendoredText(path)
        expect(sha256(text), `${path}: the vendored copy is not what VENDOR.json pins`).toBe(lfHash)
        expect([lfHash, sha256(text.replace(/\n/g, '\r\n'))], `${path}: ตัวคิดราคาในเครื่องไม่ตรงรุ่นกับ dayo`).toContain(parity.pricing_files_sha256[path])
      }
    })
    it(`holds all ${expectedCases} cases, uniquely named — a thinner export fails loudly`, () => {
      expect(parity.cases.length).toBe(expectedCases)
      expect(new Set(parity.cases.map((c) => c.spec)).size).toBe(parity.cases.length)
    })
    it('every case the tablet refuses by design is still in the file', () => {
      const specs = new Set(parity.cases.map((c) => c.spec))
      expect([...refuses.keys()].filter((k) => !specs.has(k))).toEqual([])
    })
    for (const c of parity.cases) {
      const refusal = refuses.get(c.spec)
      if (refusal !== undefined) {
        it(`${title(c)}: the tablet refuses (${refusal.code}) where dayo warns`, () => {
          expect(c.expected['warnings'], 'dayo must flag this bill').toEqual(expect.arrayContaining([expect.any(String)]))
          try { priceParityCase(c.draft, catalog, { allowMissingSaleTime: true }); expect.unreachable() } catch (e) {
            expect(e).toBeInstanceOf(CartError)
            expect((e as CartError).code).toBe(refusal.code)
          }
        })
        continue
      }
      it(`${title(c)}: 0 satang difference on every money field`, () => {
        let priced
        try {
          // dayo's export only: a case without saleTime is priced with the time absent, exactly as dayo priced it
          priced = priceParityCase(c.draft, catalog, { allowMissingSaleTime: isReal })
        } catch (e) {
          if (!(e instanceof CartError)) throw e
          expect(c.expected.ok, `the tablet refuses ${c.spec} (${e.code}) but dayo accepts it`).toBe(false)
          return
        }
        expect(priced.ok).toBe(c.expected.ok)
        if (!c.expected.ok) return
        const e = c.expected
        expect({
          itemsSubtotal: priced.itemsSubtotalSatang, itemsDiscount: priced.itemsDiscountSatang, billDiscountAmount: priced.billDiscountSatang,
          totalAmount: priced.totalSatang, channelFeeAmount: priced.channelFeeSatang,
          lines: priced.lines.map((l) => [l.lineNo, l.unitPriceSatang, l.discountPerCupSatang, l.lineTotalSatang]),
          promotionsApplied: priced.promotionsApplied.map((p) => [p.promotionId, p.discountSatang]),
        }).toEqual({
          itemsSubtotal: edgeBahtToSatang(e.itemsSubtotal), itemsDiscount: edgeBahtToSatang(e.itemsDiscount), billDiscountAmount: edgeBahtToSatang(e.billDiscountAmount),
          totalAmount: edgeBahtToSatang(e.totalAmount), channelFeeAmount: edgeBahtToSatang(e.channelFeeAmount),
          lines: e.lines.map((l) => [l.lineNo, edgeBahtToSatang(l.unitPrice), edgeBahtToSatang(l.discountPerCup), edgeBahtToSatang(l.lineTotal)]),
          promotionsApplied: e.promotionsApplied.map((p) => [p.promotionId, edgeBahtToSatang(p.discountAmount)]),
        })
      })
    }
  })
}

it('the block-2 gate runs on dayo\'s own export, not only the seed', () => {
  expect(existsSync(REAL), 'packages/dayo-pricing/fixtures/pos-parity.json (dayo pos:parity output) is missing').toBe(true)
})
paritySuite(REAL, true, 27)
paritySuite(SEED, false, 30)
