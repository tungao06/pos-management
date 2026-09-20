import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  assertSalesSummary,
  buildZReport,
  CASH_DENOMINATIONS_SATANG,
  cashInputsFromMovements,
  DEFAULT_VARIANCE_ALERT_SATANG,
  expectedCashSatang,
  MAX_ZNO_LIST_LENGTH,
  recomputeZChain,
  recomputeZChainLenient,
  summarizeShiftSales,
  tallyCashCount,
  varianceNeedsReason,
  zReportHash,
  type CashInputs,
  type CashKind,
  type LenientZEntry,
  type SalesSummary,
  type ShiftOrder,
  type ZChainWarning,
  type ZInput,
} from '../src/shift.js'

const cash: CashInputs = { openingFloatSatang: 100_000, cashSalesSatang: 523_000, voidRefundsSatang: 4_500, paidInSatang: 0, paidOutSatang: 20_000, dropsSatang: 300_000 }

describe('expectedCashSatang', () => {
  it('opening + cash sales − void refunds + paid in − paid out − drops (D36)', () => {
    expect(expectedCashSatang(cash)).toBe(100_000 + 523_000 - 4_500 - 20_000 - 300_000)
  })

  it('each input moves expected cash by exactly its own amount, in its own direction', () => {
    const base: CashInputs = { openingFloatSatang: 0, cashSalesSatang: 0, voidRefundsSatang: 0, paidInSatang: 0, paidOutSatang: 0, dropsSatang: 0 }
    expect(expectedCashSatang({ ...base, openingFloatSatang: 1 })).toBe(1)
    expect(expectedCashSatang({ ...base, cashSalesSatang: 1 })).toBe(1)
    expect(expectedCashSatang({ ...base, voidRefundsSatang: 1 })).toBe(-1)
    expect(expectedCashSatang({ ...base, paidInSatang: 1 })).toBe(1)
    expect(expectedCashSatang({ ...base, paidOutSatang: 1 })).toBe(-1)
    expect(expectedCashSatang({ ...base, dropsSatang: 1 })).toBe(-1)
  })

  it('a voided 45-baht cash bill: sale counted in cash sales, refund counted once as VOID_REFUND', () => {
    const x: CashInputs = { openingFloatSatang: 100_000, cashSalesSatang: 4_500, voidRefundsSatang: 4_500, paidInSatang: 0, paidOutSatang: 0, dropsSatang: 0 }
    expect(expectedCashSatang(x)).toBe(100_000)
  })
})

describe('cashInputsFromMovements', () => {
  it('puts every kind in its own field, each row once (D36)', () => {
    const x = cashInputsFromMovements(50_000, 9_000, [
      { kind: 'VOID_REFUND', amountSatang: 4_500 },
      { kind: 'PAID_IN', amountSatang: 10_000 },
      { kind: 'PAID_OUT', amountSatang: 2_000 },
      { kind: 'PAID_OUT', amountSatang: 500 },
      { kind: 'DROP', amountSatang: 30_000 },
    ])
    expect(x).toEqual({ openingFloatSatang: 50_000, cashSalesSatang: 9_000, voidRefundsSatang: 4_500, paidInSatang: 10_000, paidOutSatang: 2_500, dropsSatang: 30_000 })
  })

  it('refuses a zero, negative or fractional amount', () => {
    expect(() => cashInputsFromMovements(0, 0, [{ kind: 'PAID_IN', amountSatang: 0 }])).toThrow(RangeError)
    expect(() => cashInputsFromMovements(0, 0, [{ kind: 'DROP', amountSatang: -1 }])).toThrow(RangeError)
    expect(() => cashInputsFromMovements(0, 0, [{ kind: 'PAID_OUT', amountSatang: 1.5 }])).toThrow(RangeError)
  })

  it('refuses an unknown cash movement kind rather than defaulting it to DROP (M-4)', () => {
    expect(() => cashInputsFromMovements(0, 0, [{ kind: 'SALE' as CashKind, amountSatang: 500 }])).toThrow(RangeError)
  })
})

const paid = (id: string, subtotal: number, discount: number, method: 'CASH' | 'PROMPTPAY'): ShiftOrder => ({
  id, status: 'paid', subtotalSatang: subtotal, discountSatang: discount, totalSatang: subtotal - discount, payments: [{ method, amountSatang: subtotal - discount }],
})

describe('summarizeShiftSales', () => {
  it('keeps voided receipts in gross and separates them (spec §4.3); net = gross − discount − voided (Q3b-4 · D52)', () => {
    const s = summarizeShiftSales([
      paid('o1', 10_500, 500, 'CASH'),
      paid('o2', 4_500, 0, 'PROMPTPAY'),
      { ...paid('o3', 9_000, 0, 'CASH'), status: 'voided' },
    ])
    expect(s).toEqual({
      orderCount: 3, voidCount: 1, grossSalesSatang: 24_000, discountSatang: 500, voidedSatang: 9_000, netSalesSatang: 14_500,
      cashSalesSatang: 19_000, qrSalesSatang: 4_500, qrRefundedSatang: 0, qrNetSatang: 4_500,
    })
  })

  it('QR received / refunded / net: a voided PromptPay receipt was transferred back (Q3b-12 · D53)', () => {
    const s = summarizeShiftSales([paid('o1', 4_500, 0, 'PROMPTPAY'), { ...paid('o2', 5_000, 0, 'PROMPTPAY'), status: 'voided' }, { ...paid('o3', 4_000, 0, 'CASH'), status: 'voided' }])
    expect(s).toMatchObject({ qrSalesSatang: 9_500, qrRefundedSatang: 5_000, qrNetSatang: 4_500, voidedSatang: 9_000 })
    expect(() => assertSalesSummary({ ...s, qrNetSatang: 4_501 })).toThrow(RangeError)
    expect(() => assertSalesSummary({ ...s, qrRefundedSatang: 9_501, qrNetSatang: -1 })).toThrow(RangeError)
  })

  it('refuses an order whose payments or totals do not add up (spec §4.1)', () => {
    expect(() => summarizeShiftSales([{ ...paid('o1', 4_500, 0, 'CASH'), payments: [{ method: 'CASH', amountSatang: 4_000 }] }])).toThrow(/payments/)
    expect(() => summarizeShiftSales([{ ...paid('o1', 4_500, 0, 'CASH'), totalSatang: 4_400 }])).toThrow(/total/)
  })

  it('refuses an unknown order status or payment method (M-4)', () => {
    expect(() => summarizeShiftSales([{ ...paid('o1', 4_500, 0, 'CASH'), status: 'open' as ShiftOrder['status'] }])).toThrow(RangeError)
    expect(() =>
      summarizeShiftSales([{ ...paid('o1', 4_500, 0, 'CASH'), payments: [{ method: 'BANK' as ShiftOrder['payments'][number]['method'], amountSatang: 4_500 }] }]),
    ).toThrow(RangeError)
  })

  it('refuses a forged summary: cash refunded > cash sales, or zero orders with gross > 0 (M-3)', () => {
    const forgedCashRefund: SalesSummary = {
      orderCount: 1, voidCount: 1, grossSalesSatang: 10_000, discountSatang: 0, voidedSatang: 10_000, netSalesSatang: 0,
      cashSalesSatang: 0, qrSalesSatang: 10_000, qrRefundedSatang: 0, qrNetSatang: 10_000,
    }
    expect(() => assertSalesSummary(forgedCashRefund)).toThrow(RangeError)
    expect(() =>
      assertSalesSummary({ orderCount: 0, voidCount: 0, grossSalesSatang: 1, discountSatang: 0, voidedSatang: 0, netSalesSatang: 1, cashSalesSatang: 0, qrSalesSatang: 1, qrRefundedSatang: 0, qrNetSatang: 1 }),
    ).toThrow(RangeError)
  })

  it('an empty shift is all zeros', () => {
    expect(summarizeShiftSales([])).toEqual({
      orderCount: 0, voidCount: 0, grossSalesSatang: 0, discountSatang: 0, voidedSatang: 0, netSalesSatang: 0,
      cashSalesSatang: 0, qrSalesSatang: 0, qrRefundedSatang: 0, qrNetSatang: 0,
    })
  })

  it('property: the summary always satisfies assertSalesSummary; net and QR net = Σ of the receipts still paid', () => {
    const orderArb = fc
      .record({ subtotal: fc.integer({ min: 1, max: 1_000_000 }), discountPct: fc.integer({ min: 0, max: 99 }), voided: fc.boolean(), cash: fc.boolean(), n: fc.nat() })
      .map(({ subtotal, discountPct, voided, cash, n }): ShiftOrder => {
        const discount = Math.floor((subtotal * discountPct) / 100)
        return { ...paid(`o${n}`, subtotal, discount, cash ? 'CASH' : 'PROMPTPAY'), status: voided ? 'voided' : 'paid' }
      })
    fc.assert(
      fc.property(fc.array(orderArb, { maxLength: 60 }), (orders) => {
        const s = summarizeShiftSales(orders)
        assertSalesSummary(s)
        const kept = orders.filter((o) => o.status === 'paid')
        expect(s.netSalesSatang).toBe(kept.reduce((a, o) => a + o.totalSatang, 0))
        expect(s.qrNetSatang).toBe(kept.filter((o) => o.payments[0]!.method === 'PROMPTPAY').reduce((a, o) => a + o.totalSatang, 0))
      }),
    )
  })
})

describe('tallyCashCount / varianceNeedsReason', () => {
  it('uses the 9 denominations of spec §5, no satang coins (Q3b-1 · D52), largest first, missing = 0', () => {
    expect(CASH_DENOMINATIONS_SATANG).toEqual([100_000, 50_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100])
    const t = tallyCashCount([{ denominationSatang: 100, count: 3 }, { denominationSatang: 100_000, count: 2 }])
    expect(t.totalSatang).toBe(200_300)
    expect(t.lines.map((l) => l.count)).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 3])
  })

  it('refuses unknown or repeated denominations and bad counts', () => {
    expect(() => tallyCashCount([{ denominationSatang: 50, count: 1 }])).toThrow(RangeError)
    expect(() => tallyCashCount([{ denominationSatang: 100, count: 1 }, { denominationSatang: 100, count: 2 }])).toThrow(RangeError)
    expect(() => tallyCashCount([{ denominationSatang: 100, count: -1 }])).toThrow(RangeError)
    expect(() => tallyCashCount([{ denominationSatang: 100, count: 1.5 }])).toThrow(RangeError)
    expect(() => tallyCashCount([{ denominationSatang: 100, count: 100_000 }])).toThrow(RangeError)
  })

  it('needs a reason only when the shortage or overage is strictly above the threshold (spec §4.8)', () => {
    expect(varianceNeedsReason(2_000, 2_000)).toBe(false)
    expect(varianceNeedsReason(-2_000, 2_000)).toBe(false)
    expect(varianceNeedsReason(2_001, 2_000)).toBe(true)
    expect(varianceNeedsReason(-2_001, 2_000)).toBe(true)
    expect(varianceNeedsReason(0, 0)).toBe(false)
    expect(varianceNeedsReason(1, 0)).toBe(true)
  })
})

describe('recomputeZChain (Q3b-11 · D53)', () => {
  const salesOf = (net: number): SalesSummary => ({
    orderCount: net > 0 ? 1 : 0, voidCount: 0, grossSalesSatang: net, discountSatang: 0, voidedSatang: 0, netSalesSatang: net,
    cashSalesSatang: net, qrSalesSatang: 0, qrRefundedSatang: 0, qrNetSatang: 0,
  })

  it('Z count and Σ net of every earlier snapshot, zNo running 1..n', () => {
    expect(recomputeZChain([])).toEqual({ zNo: 0, grandTotalSatang: 0 })
    expect(recomputeZChain([1, 2, 3].map((zNo, i) => ({ zNo, sales: salesOf([4_000, 0, 10_000][i]!) })))).toEqual({ zNo: 3, grandTotalSatang: 14_000 })
  })

  it('refuses a snapshot whose SalesSummary is internally inconsistent (I-1: assertSalesSummary on each)', () => {
    expect(() => recomputeZChain([{ zNo: 1, sales: { ...salesOf(4_000), voidCount: 2 } }])).toThrow(RangeError)
  })

  it('refuses a missing zNo (a gap) — I-1', () => {
    expect(() => recomputeZChain([{ zNo: 1, sales: salesOf(4_000) }, { zNo: 3, sales: salesOf(10_000) }])).toThrow(RangeError)
  })

  it('refuses a duplicate zNo — I-1', () => {
    expect(() => recomputeZChain([{ zNo: 1, sales: salesOf(4_000) }, { zNo: 1, sales: salesOf(10_000) }])).toThrow(RangeError)
  })

  it('does not trust a snapshot whose stored net was tampered with — I-1', () => {
    const tampered: SalesSummary = { ...salesOf(4_000), netSalesSatang: 9_000 }
    expect(() => recomputeZChain([{ zNo: 1, sales: tampered }])).toThrow(RangeError)
  })

  it('throws once the running total would pass Number.MAX_SAFE_INTEGER (M-1)', () => {
    const huge = salesOf(Number.MAX_SAFE_INTEGER)
    expect(() => recomputeZChain([{ zNo: 1, sales: huge }, { zNo: 2, sales: salesOf(1) }])).toThrow(RangeError)
  })
})

describe('recomputeZChainLenient (Q3b-16 · D54): never throws, unlike recomputeZChain', () => {
  const entryOf = (shiftId: string, net: number, extra: Partial<LenientZEntry> = {}): LenientZEntry => ({
    shiftId, zNo: null, grossSalesSatang: net, discountSatang: 0, voidedSatang: 0, netSalesSatang: net, ...extra,
  })
  const noZNoLists = { duplicateZNos: [], duplicateZNosTruncated: false, maxStoredZNo: 0, missingZNosTruncated: false }

  it('an empty chain gives Z0, grand 0, nothing unreadable, duplicated or missing', () => {
    expect(recomputeZChainLenient([])).toEqual({ zNo: 0, grandTotalSatang: 0, unreadable: [], missingZNos: [], ...noZNoLists })
  })

  it('a consistent gross/discount/voided triple is trusted over a tampered stored net (Q3b-16 rule 1)', () => {
    const e = entryOf('s1', 4_000, { grossSalesSatang: 4_500, discountSatang: 500, voidedSatang: 0, netSalesSatang: 1 }) // net lies, gross/discount/voided don't
    expect(recomputeZChainLenient([e])).toEqual({ zNo: 1, grandTotalSatang: 4_000, unreadable: [], missingZNos: [1], ...noZNoLists })
  })

  it('an inconsistent triple falls back to the stored net, and is listed as unreadable (rule 2)', () => {
    const e = entryOf('s1', 0, { grossSalesSatang: 1_000, discountSatang: 2_000, voidedSatang: 0, netSalesSatang: 7_000 }) // discount > gross
    expect(recomputeZChainLenient([e])).toEqual({ zNo: 1, grandTotalSatang: 7_000, unreadable: [{ shiftId: 's1', zNo: null }], missingZNos: [1], ...noZNoLists })
  })

  it('a negative stored net is refused too (review NF-2) — falls back to 0, still flagged unreadable', () => {
    const e = entryOf('s1', 0, { grossSalesSatang: 1_000, discountSatang: 2_000, voidedSatang: 0, netSalesSatang: -100_000 }) // inconsistent triple; the "fallback" net is itself negative
    expect(recomputeZChainLenient([e])).toEqual({ zNo: 1, grandTotalSatang: 0, unreadable: [{ shiftId: 's1', zNo: null }], missingZNos: [1], ...noZNoLists })
  })

  it('a missing gross/discount/voided AND a missing/non-integer stored net falls back to 0, and is listed as unreadable (rule 3)', () => {
    const e: LenientZEntry = { shiftId: 's1', zNo: 3, grossSalesSatang: null, discountSatang: null, voidedSatang: null, netSalesSatang: 1.5 }
    // entries.length is 1, so the missing-zNo scan only ever looks at 1..1 (review R2-2) — it never reaches up to the claimed zNo 3
    expect(recomputeZChainLenient([e])).toEqual({ zNo: 1, grandTotalSatang: 0, unreadable: [{ shiftId: 's1', zNo: 3 }], missingZNos: [1], duplicateZNos: [], duplicateZNosTruncated: false, missingZNosTruncated: false, maxStoredZNo: 3 })
  })

  it('sums nets in the order given, zNo is simply the entry count, and totals are pinned literally', () => {
    const chain = recomputeZChainLenient([entryOf('s1', 4_000, { zNo: 1 }), entryOf('s2', 0, { zNo: 2 }), entryOf('s3', 10_000, { zNo: 3 })])
    expect(chain).toEqual({ zNo: 3, grandTotalSatang: 14_000, unreadable: [], missingZNos: [], duplicateZNos: [], duplicateZNosTruncated: false, missingZNosTruncated: false, maxStoredZNo: 3 })
  })

  it('a mix of readable and unreadable entries sums correctly and lists only the unreadable ones', () => {
    const readable = entryOf('s1', 4_000, { zNo: 1 })
    const badTriple = entryOf('s2', 5_000, { zNo: 2, grossSalesSatang: 100, discountSatang: 200, voidedSatang: 0, netSalesSatang: 5_000 }) // inconsistent triple, valid stored net
    const wholeRowGone = { shiftId: 's3', zNo: null, grossSalesSatang: null, discountSatang: null, voidedSatang: null, netSalesSatang: null }
    expect(recomputeZChainLenient([readable, badTriple, wholeRowGone])).toEqual({
      zNo: 3,
      grandTotalSatang: 4_000 + 5_000 + 0,
      unreadable: [{ shiftId: 's2', zNo: 2 }, { shiftId: 's3', zNo: null }],
      duplicateZNos: [],
      duplicateZNosTruncated: false,
      missingZNos: [3], // entries.length is 3; zNo 1 and 2 are claimed, 3 (the row without any readable zNo) is not
      missingZNosTruncated: false,
      maxStoredZNo: 2,
    })
  })

  it('never lets the running total exceed Number.MAX_SAFE_INTEGER (review NF-2) — an entry that would push it over is skipped and flagged instead', () => {
    const normal = entryOf('s1', 4_000, { zNo: 1 })
    const huge = entryOf('s2', 0, { zNo: 2, grossSalesSatang: Number.MAX_SAFE_INTEGER, discountSatang: 0, voidedSatang: 0, netSalesSatang: Number.MAX_SAFE_INTEGER })
    const chain = recomputeZChainLenient([normal, huge]) // normal is folded in first and fits; huge on top of it would overflow
    expect(chain.grandTotalSatang).toBe(4_000) // huge is dropped rather than pushing the total unsafe
    expect(Number.isSafeInteger(chain.grandTotalSatang)).toBe(true)
    expect(chain.unreadable).toEqual([{ shiftId: 's2', zNo: 2 }])
  })

  it('names duplicate and missing zNos (review NF-4)', () => {
    const chain = recomputeZChainLenient([entryOf('s1', 1_000, { zNo: 1 }), entryOf('s2', 1_000, { zNo: 4 }), entryOf('s3', 1_000, { zNo: 4 })])
    expect(chain.duplicateZNos).toEqual([4])
    // entries.length is 3, so the scan only reaches 1..3 (review R2-2) — 4 is above the row count and is not named as "missing"
    expect(chain.missingZNos).toEqual([2, 3])
    expect(chain.maxStoredZNo).toBe(4)
  })

  it('ignores zNo <= 0 for duplicate/missing naming (review R2-1) — those rows are already flagged unreadable another way', () => {
    const chain = recomputeZChainLenient([entryOf('s1', 1_000, { zNo: 0 }), entryOf('s2', 1_000, { zNo: 0 }), entryOf('s3', 1_000, { zNo: -3 })])
    expect(chain.duplicateZNos).toEqual([]) // zNo 0 appears twice, but 0 is never a candidate at all
    expect(chain.missingZNos).toEqual([1, 2, 3]) // none of the three rows has a readable zNo >= 1
    expect(chain.maxStoredZNo).toBe(0)
  })

  it('never scans past the row count, however huge a stray zNo claims to be (review R2-2)', () => {
    const started = performance.now()
    const chain = recomputeZChainLenient([entryOf('s1', 1_000, { zNo: 2_000_000 }), entryOf('s2', 1_000, { zNo: 2 }), entryOf('s3', 1_000, { zNo: 3 })])
    expect(performance.now() - started).toBeLessThan(200) // would hang for seconds (or exhaust memory) if the scan ran 1..2_000_000
    expect(chain.maxStoredZNo).toBe(2_000_000) // the scalar itself is harmless to keep, however large
    expect(chain.missingZNos).toEqual([1]) // scanned only 1..3 (the row count); 2_000_000 is simply never visited
    expect(chain.missingZNosTruncated).toBe(false)
  })

  it('caps missingZNos at MAX_ZNO_LIST_LENGTH and flags the rest as truncated (review R2-2)', () => {
    const entries = Array.from({ length: MAX_ZNO_LIST_LENGTH + 10 }, (_, i) => entryOf(`s${i}`, 0)) // none of them claim any zNo at all
    const chain = recomputeZChainLenient(entries)
    expect(chain.missingZNos).toEqual(Array.from({ length: MAX_ZNO_LIST_LENGTH }, (_, i) => i + 1))
    expect(chain.missingZNosTruncated).toBe(true)
  })

  it('caps duplicateZNos at MAX_ZNO_LIST_LENGTH and flags the rest as truncated (review R2-2)', () => {
    const entries = Array.from({ length: MAX_ZNO_LIST_LENGTH + 10 }, (_, i) => [entryOf(`a${i}`, 0, { zNo: i + 1 }), entryOf(`b${i}`, 0, { zNo: i + 1 })]).flat()
    const chain = recomputeZChainLenient(entries)
    expect(chain.duplicateZNos).toHaveLength(MAX_ZNO_LIST_LENGTH)
    expect(chain.duplicateZNosTruncated).toBe(true)
  })

  it('property: the result always satisfies buildZReport as `prev`, and as a real, non-null chainWarning built from its own lists — never BAD_INPUT, whatever the earlier rows claim (review NF-2, NF-7, R2-1, R2-2)', () => {
    const zeroSales: SalesSummary = { orderCount: 0, voidCount: 0, grossSalesSatang: 0, discountSatang: 0, voidedSatang: 0, netSalesSatang: 0, cashSalesSatang: 0, qrSalesSatang: 0, qrRefundedSatang: 0, qrNetSatang: 0 }
    const zeroCash: CashInputs = { openingFloatSatang: 0, cashSalesSatang: 0, voidRefundsSatang: 0, paidInSatang: 0, paidOutSatang: 0, dropsSatang: 0 }
    const wide = fc.integer({ min: -10, max: Number.MAX_SAFE_INTEGER })
    // review R2-1/R2-2: the zNo arbitrary now also reaches zNo <= 0 and huge (near-MAX_SAFE_INTEGER) values, on top
    // of the small range that already produced duplicates and gaps — exactly the inputs the earlier property test
    // (which only ever passed `chainWarning: null`) never exercised.
    const entryArb = fc.record({
      shiftId: fc.string({ minLength: 1, maxLength: 8 }).filter((s) => s.trim() !== ''), // real ids are never blank; buildZReport rejects one that is, same as unreadableZs entries

      zNo: fc.option(fc.oneof(fc.integer({ min: -5, max: 6 }), fc.integer({ min: Number.MAX_SAFE_INTEGER - 5, max: Number.MAX_SAFE_INTEGER })), { nil: null }),
      grossSalesSatang: fc.option(wide, { nil: null }),
      discountSatang: fc.option(wide, { nil: null }),
      voidedSatang: fc.option(wide, { nil: null }),
      netSalesSatang: fc.option(wide, { nil: null }),
    })
    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 15 }), (entries) => {
        const chain = recomputeZChainLenient(entries)
        const chainWarning: ZChainWarning = {
          brokenShiftId: 's-broken',
          storedGrandTotalSatang: null,
          recomputedGrandTotalSatang: chain.grandTotalSatang,
          acknowledgedBy: 'u1',
          unreadableZs: chain.unreadable,
          duplicateZNos: chain.duplicateZNos,
          duplicateZNosTruncated: chain.duplicateZNosTruncated,
          missingZNos: chain.missingZNos,
          missingZNosTruncated: chain.missingZNosTruncated,
          deletedShiftIds: [],
          deletedShiftIdsTruncated: false,
        }
        const currentShift: ZInput = {
          shiftId: 's-current', businessDate: '2026-09-17', deviceId: 'dev-A', zNo: chain.zNo + 1, openedAt: '2026-09-17T01:00:00.000Z', openedBy: 'u1', openedQuick: false,
          closedAt: '2026-09-17T13:05:00.000Z', closedBy: 'u1', countedBy: 'u1',
          sales: zeroSales, cash: zeroCash, countLines: [], countedCashSatang: 0, varianceAlertSatang: 2_000, varianceReason: null, voids: [], bankQrTotalSatang: null, chainWarning,
        }
        buildZReport(currentShift, { zNo: chain.zNo, grandTotalSatang: chain.grandTotalSatang }) // must never throw
      }),
    )
  })
})

describe('buildZReport', () => {
  const sales: SalesSummary = {
    orderCount: 3, voidCount: 1, grossSalesSatang: 24_000, discountSatang: 500, voidedSatang: 9_000, netSalesSatang: 14_500,
    cashSalesSatang: 19_000, qrSalesSatang: 4_500, qrRefundedSatang: 0, qrNetSatang: 4_500,
  }
  const zCash: CashInputs = { openingFloatSatang: 50_000, cashSalesSatang: 19_000, voidRefundsSatang: 9_000, paidInSatang: 0, paidOutSatang: 2_000, dropsSatang: 0 }
  // expected = 50_000 + 19_000 − 9_000 − 2_000 = 58_000
  const input: ZInput = {
    shiftId: 's1', businessDate: '2026-09-17', deviceId: 'dev-A', zNo: 1, openedAt: '2026-09-17T01:00:00.000Z', openedBy: 'u1', openedQuick: false,
    closedAt: '2026-09-17T13:05:00.000Z', closedBy: 'u1', countedBy: 'u2',
    sales, cash: zCash,
    countLines: [{ denominationSatang: 50_000, count: 1 }, { denominationSatang: 5_000, count: 1 }, { denominationSatang: 1_000, count: 3 }],
    countedCashSatang: 58_000,
    varianceAlertSatang: 2_000,
    varianceReason: null,
    voids: [{ orderId: 'o3', receiptNo: 'A-000003', totalSatang: 9_000, method: 'CASH', reason: 'กดผิดเมนู', made: false, approvedBy: 'u1', approvedByName: 'TungAo', refundReference: null, voidedAt: '2026-09-17T05:00:00.000Z' }],
    bankQrTotalSatang: null,
    chainWarning: null,
  }

  it('computes expected cash, variance and running grand total; normalizes the count lines', () => {
    const z = buildZReport(input, { zNo: 0, grandTotalSatang: 10_000_000 })
    expect(z.snapshot.expectedCashSatang).toBe(58_000)
    expect(z.snapshot.cashVarianceSatang).toBe(0)
    expect(z.snapshot.grandTotalSatang).toBe(10_014_500)
    expect(z.snapshot.qrDifferenceSatang).toBeNull()
    expect(z.snapshot.countLines).toHaveLength(9)
    expect(z.hash).toBe(zReportHash(z.snapshot))
    expect(z.hash).toHaveLength(64)
  })

  it('refuses a grand total that would pass Number.MAX_SAFE_INTEGER (M-1)', () => {
    expect(() => buildZReport(input, { zNo: 0, grandTotalSatang: Number.MAX_SAFE_INTEGER })).toThrow(RangeError)
  })

  it('pins the base input to a known golden hash (M-7): any change to canonicalization or snapshot shape must be deliberate', () => {
    expect(buildZReport(input, null).hash).toBe('bf90b64e36954495d2e4e385fd006d4ebcfe17febc914ba6607fef06a5cee4a4')
  })

  it('a variance exactly at the alert threshold does not need a reason, with a non-default threshold too (M-7, spec §4.8 equality)', () => {
    // expected cash is 58_000 either way; countLines are rebuilt to sum to the new countedCashSatang exactly.
    const z1 = buildZReport(
      { ...input, countLines: [{ denominationSatang: 50_000, count: 1 }, { denominationSatang: 10_000, count: 1 }], countedCashSatang: 60_000 },
      null,
    )
    expect(z1.snapshot).toMatchObject({ cashVarianceSatang: DEFAULT_VARIANCE_ALERT_SATANG, varianceReason: null })
    const z2 = buildZReport(
      {
        ...input,
        varianceAlertSatang: 500,
        countLines: [{ denominationSatang: 50_000, count: 1 }, { denominationSatang: 5_000, count: 1 }, { denominationSatang: 2_000, count: 1 }, { denominationSatang: 500, count: 1 }],
        countedCashSatang: 57_500,
      },
      null,
    )
    expect(z2.snapshot).toMatchObject({ cashVarianceSatang: -500, varianceReason: null })
  })

  it('a zero-sales Z is accepted; the grand total carries forward unchanged (M-7)', () => {
    const zeroSales: SalesSummary = { orderCount: 0, voidCount: 0, grossSalesSatang: 0, discountSatang: 0, voidedSatang: 0, netSalesSatang: 0, cashSalesSatang: 0, qrSalesSatang: 0, qrRefundedSatang: 0, qrNetSatang: 0 }
    const zeroCash: CashInputs = { openingFloatSatang: 50_000, cashSalesSatang: 0, voidRefundsSatang: 0, paidInSatang: 0, paidOutSatang: 0, dropsSatang: 0 }
    const z = buildZReport(
      { ...input, sales: zeroSales, cash: zeroCash, countLines: [{ denominationSatang: 50_000, count: 1 }], countedCashSatang: 50_000, voids: [] },
      { zNo: 0, grandTotalSatang: 1_000_000 },
    )
    expect(z.snapshot).toMatchObject({ expectedCashSatang: 50_000, cashVarianceSatang: 0, grandTotalSatang: 1_000_000 })
  })

  it('a voids-only Z: net sales zero, the single cash void ties out the drawer (M-7)', () => {
    const onlyVoidSales: SalesSummary = {
      orderCount: 1, voidCount: 1, grossSalesSatang: 5_000, discountSatang: 500, voidedSatang: 4_500, netSalesSatang: 0,
      cashSalesSatang: 4_500, qrSalesSatang: 0, qrRefundedSatang: 0, qrNetSatang: 0,
    }
    const onlyVoidCash: CashInputs = { openingFloatSatang: 50_000, cashSalesSatang: 4_500, voidRefundsSatang: 4_500, paidInSatang: 0, paidOutSatang: 0, dropsSatang: 0 }
    const z = buildZReport(
      {
        ...input, sales: onlyVoidSales, cash: onlyVoidCash, countedCashSatang: 50_000, countLines: [{ denominationSatang: 50_000, count: 1 }],
        voids: [{ orderId: 'oV', receiptNo: 'A-000001', totalSatang: 4_500, method: 'CASH', reason: 'ลูกค้าเปลี่ยนใจ', made: false, approvedBy: 'u1', approvedByName: 'TungAo', refundReference: null, voidedAt: '2026-09-17T02:00:00.000Z' }],
      },
      null,
    )
    expect(z.snapshot).toMatchObject({ expectedCashSatang: 50_000, cashVarianceSatang: 0, grandTotalSatang: 0 })
  })

  it('an accepted PromptPay void: the QR-refund tie-out passes without any cash movement (M-7)', () => {
    const qrVoidSales: SalesSummary = {
      orderCount: 2, voidCount: 1, grossSalesSatang: 9_500, discountSatang: 0, voidedSatang: 5_000, netSalesSatang: 4_500,
      cashSalesSatang: 0, qrSalesSatang: 9_500, qrRefundedSatang: 5_000, qrNetSatang: 4_500,
    }
    const qrVoidCash: CashInputs = { openingFloatSatang: 50_000, cashSalesSatang: 0, voidRefundsSatang: 0, paidInSatang: 0, paidOutSatang: 0, dropsSatang: 0 }
    const z = buildZReport(
      {
        ...input, sales: qrVoidSales, cash: qrVoidCash, countedCashSatang: 50_000, countLines: [{ denominationSatang: 50_000, count: 1 }],
        voids: [{ orderId: 'oQ', receiptNo: 'A-000002', totalSatang: 5_000, method: 'PROMPTPAY', reason: 'สั่งผิด', made: true, approvedBy: 'u1', approvedByName: 'TungAo', refundReference: 'REF123', voidedAt: '2026-09-17T03:00:00.000Z' }],
      },
      null,
    )
    expect(z.snapshot).toMatchObject({ expectedCashSatang: 50_000, cashVarianceSatang: 0, grandTotalSatang: 4_500 })
  })

  it('checks each void entry individually: positive integer amount, unique orderId, non-blank reason (M-2)', () => {
    expect(() => buildZReport({ ...input, voids: [{ ...input.voids[0]!, totalSatang: -9_000 }] }, null)).toThrow(RangeError)
    expect(() => buildZReport({ ...input, voids: [{ ...input.voids[0]!, totalSatang: 4_500.5 }] }, null)).toThrow(RangeError)
    expect(() =>
      buildZReport(
        {
          ...input,
          sales: { ...sales, voidCount: 2, voidedSatang: 18_000, netSalesSatang: 5_500 },
          cash: { ...zCash, voidRefundsSatang: 18_000 },
          voids: [input.voids[0]!, { ...input.voids[0]! }],
        },
        null,
      ),
    ).toThrow(RangeError)
    expect(() => buildZReport({ ...input, voids: [{ ...input.voids[0]!, reason: '   ' }] }, null)).toThrow(RangeError)
  })

  it('hash changes when any number changes, and is stable', () => {
    const a = buildZReport(input, null).hash
    expect(buildZReport({ ...input, cash: { ...zCash, paidOutSatang: 2_001 } }, null).hash).not.toBe(a)
    expect(buildZReport(input, { zNo: 0, grandTotalSatang: 1 }).hash).not.toBe(a)
    expect(buildZReport(input, null).hash).toBe(a)
  })

  it('a variance above the threshold needs a reason; the reason is trimmed (spec §4.8)', () => {
    const short: ZInput = { ...input, countLines: [{ denominationSatang: 50_000, count: 1 }, { denominationSatang: 5_000, count: 1 }], countedCashSatang: 55_000 }
    expect(() => buildZReport(short, null)).toThrow(/reason/)
    expect(() => buildZReport({ ...short, varianceReason: '   ' }, null)).toThrow(/reason/)
    const z = buildZReport({ ...short, varianceReason: '  ทอนผิด  ' }, null)
    expect(z.snapshot).toMatchObject({ cashVarianceSatang: -3_000, varianceReason: 'ทอนผิด' })
  })

  it('freezes the bank-app QR total and the QR difference = bank − QR net (Q3b-12 · D53)', () => {
    expect(buildZReport({ ...input, bankQrTotalSatang: 4_000 }, null).snapshot).toMatchObject({ bankQrTotalSatang: 4_000, qrDifferenceSatang: -500 })
    expect(buildZReport({ ...input, bankQrTotalSatang: 4_500 }, null).snapshot.qrDifferenceSatang).toBe(0)
    expect(() => buildZReport({ ...input, bankQrTotalSatang: -1 }, null)).toThrow(RangeError)
    expect(() => buildZReport({ ...input, bankQrTotalSatang: 0.5 }, null)).toThrow(RangeError)
  })

  it('a chain warning is frozen into the Z and must match the recomputed chain it chains from (Q3b-11 · D53)', () => {
    const w: ZChainWarning = {
      brokenShiftId: 's0', storedGrandTotalSatang: 999, recomputedGrandTotalSatang: 4_000, acknowledgedBy: 'u1', unreadableZs: [],
      duplicateZNos: [], duplicateZNosTruncated: false, missingZNos: [], missingZNosTruncated: false, deletedShiftIds: [], deletedShiftIdsTruncated: false,
    }
    const z = buildZReport({ ...input, zNo: 2, chainWarning: w }, { zNo: 1, grandTotalSatang: 4_000 })
    expect(z.snapshot).toMatchObject({ chainWarning: w, grandTotalSatang: 18_500 })
    expect(z.hash).toBe(zReportHash(z.snapshot))
    expect(() => buildZReport({ ...input, zNo: 2, chainWarning: w }, { zNo: 1, grandTotalSatang: 999 })).toThrow(RangeError)
    expect(() => buildZReport({ ...input, chainWarning: w }, null)).toThrow(RangeError)
    expect(() => buildZReport({ ...input, zNo: 2, chainWarning: { ...w, acknowledgedBy: '' } }, { zNo: 1, grandTotalSatang: 4_000 })).toThrow(RangeError)
  })

  it('a chain warning with unreadableZs (Q3b-16 · D54) is frozen too; a malformed entry is refused', () => {
    const w: ZChainWarning = {
      brokenShiftId: 's0',
      storedGrandTotalSatang: null,
      recomputedGrandTotalSatang: 4_000,
      acknowledgedBy: 'u1',
      unreadableZs: [{ shiftId: 's0', zNo: 1 }, { shiftId: 'sX', zNo: null }],
      duplicateZNos: [],
      duplicateZNosTruncated: false,
      missingZNos: [],
      missingZNosTruncated: false,
      deletedShiftIds: [],
      deletedShiftIdsTruncated: false,
    }
    const z = buildZReport({ ...input, zNo: 2, chainWarning: w }, { zNo: 1, grandTotalSatang: 4_000 })
    expect(z.snapshot.chainWarning).toEqual(w)
    expect(() => buildZReport({ ...input, zNo: 2, chainWarning: { ...w, unreadableZs: [{ shiftId: '', zNo: 1 }] } }, { zNo: 1, grandTotalSatang: 4_000 })).toThrow(RangeError)
    expect(() => buildZReport({ ...input, zNo: 2, chainWarning: { ...w, unreadableZs: [{ shiftId: 's0', zNo: 1.5 }] } }, { zNo: 1, grandTotalSatang: 4_000 })).toThrow(RangeError)
  })

  it('a chain warning names duplicate/missing zNos (review NF-4); a malformed entry, or one over the cap, is refused too (review R2-2)', () => {
    const w: ZChainWarning = {
      brokenShiftId: 's0',
      storedGrandTotalSatang: null,
      recomputedGrandTotalSatang: 4_000,
      acknowledgedBy: 'u1',
      unreadableZs: [],
      duplicateZNos: [4],
      duplicateZNosTruncated: false,
      missingZNos: [2, 3],
      missingZNosTruncated: true, // the truncated flag itself is just a boolean the caller reports — buildZReport does not recompute it
      deletedShiftIds: [],
      deletedShiftIdsTruncated: false,
    }
    const z = buildZReport({ ...input, zNo: 2, chainWarning: w }, { zNo: 1, grandTotalSatang: 4_000 })
    expect(z.snapshot.chainWarning).toEqual(w)
    expect(() => buildZReport({ ...input, zNo: 2, chainWarning: { ...w, duplicateZNos: [0] } }, { zNo: 1, grandTotalSatang: 4_000 })).toThrow(RangeError)
    expect(() => buildZReport({ ...input, zNo: 2, chainWarning: { ...w, missingZNos: [1.5] } }, { zNo: 1, grandTotalSatang: 4_000 })).toThrow(RangeError)
    expect(() => buildZReport({ ...input, zNo: 2, chainWarning: { ...w, missingZNos: Array.from({ length: MAX_ZNO_LIST_LENGTH + 1 }, (_, i) => i + 1) } }, { zNo: 1, grandTotalSatang: 4_000 })).toThrow(RangeError)
    expect(() => buildZReport({ ...input, zNo: 2, chainWarning: { ...w, missingZNosTruncated: 'yes' as unknown as boolean } }, { zNo: 1, grandTotalSatang: 4_000 })).toThrow(RangeError)
  })

  it('a chain warning names deleted shifts (review R2-4); a malformed entry, or one over the cap, is refused too', () => {
    const w: ZChainWarning = {
      brokenShiftId: 's-deleted',
      storedGrandTotalSatang: null,
      recomputedGrandTotalSatang: 4_000,
      acknowledgedBy: 'u1',
      unreadableZs: [],
      duplicateZNos: [],
      duplicateZNosTruncated: false,
      missingZNos: [],
      missingZNosTruncated: false,
      deletedShiftIds: ['s-deleted'],
      deletedShiftIdsTruncated: false,
    }
    const z = buildZReport({ ...input, zNo: 2, chainWarning: w }, { zNo: 1, grandTotalSatang: 4_000 })
    expect(z.snapshot.chainWarning).toEqual(w)
    expect(() => buildZReport({ ...input, zNo: 2, chainWarning: { ...w, deletedShiftIds: [''] } }, { zNo: 1, grandTotalSatang: 4_000 })).toThrow(RangeError)
    expect(() => buildZReport({ ...input, zNo: 2, chainWarning: { ...w, deletedShiftIds: Array.from({ length: MAX_ZNO_LIST_LENGTH + 1 }, (_, i) => `s${i}`) } }, { zNo: 1, grandTotalSatang: 4_000 })).toThrow(RangeError)
    expect(() => buildZReport({ ...input, zNo: 2, chainWarning: { ...w, deletedShiftIdsTruncated: 1 as unknown as boolean } }, { zNo: 1, grandTotalSatang: 4_000 })).toThrow(RangeError)
  })

  it('a chain warning may have prevZNo 0 when every earlier Z row was deleted (review R2-4) — nothing to chain from, still something to name', () => {
    const w: ZChainWarning = {
      brokenShiftId: 's-deleted',
      storedGrandTotalSatang: null,
      recomputedGrandTotalSatang: 0,
      acknowledgedBy: 'u1',
      unreadableZs: [],
      duplicateZNos: [],
      duplicateZNosTruncated: false,
      missingZNos: [],
      missingZNosTruncated: false,
      deletedShiftIds: ['s-deleted'],
      deletedShiftIdsTruncated: false,
    }
    const z = buildZReport({ ...input, zNo: 1, chainWarning: w }, { zNo: 0, grandTotalSatang: 0 })
    expect(z.snapshot).toMatchObject({ zNo: 1, grandTotalSatang: 14_500, chainWarning: w })
  })

  it('refuses inconsistent inputs (Plan 1 notes §4)', () => {
    expect(() => buildZReport({ ...input, sales: { ...sales, netSalesSatang: 14_501 } }, null)).toThrow(RangeError)
    expect(() => buildZReport({ ...input, sales: { ...sales, qrSalesSatang: 4_501 } }, null)).toThrow(RangeError)
    expect(() => buildZReport({ ...input, cash: { ...zCash, cashSalesSatang: 19_001 } }, null)).toThrow(RangeError)
    expect(() => buildZReport({ ...input, countedCashSatang: 58_001 }, null)).toThrow(RangeError)
    expect(() => buildZReport({ ...input, voids: [] }, null)).toThrow(RangeError)
    expect(() => buildZReport(input, { zNo: 0, grandTotalSatang: -1 })).toThrow(RangeError)
    expect(() => buildZReport({ ...input, zNo: 3 }, { zNo: 1, grandTotalSatang: 0 })).toThrow(RangeError)
    // the void list ties to the cash drawer (VOID_REFUND rows) and to the QR refunds
    expect(() => buildZReport({ ...input, cash: { ...zCash, voidRefundsSatang: 8_999 } }, null)).toThrow(RangeError)
    expect(() => buildZReport({ ...input, voids: [{ ...input.voids[0]!, method: 'PROMPTPAY' }] }, null)).toThrow(RangeError)
  })
})
