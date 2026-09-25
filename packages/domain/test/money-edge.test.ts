import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { EDGE_MAX_SATANG, edgeBahtToSatang, edgeSatangToBaht, MoneyEdgeError } from '../src/money-edge.js'

const TWO_DECIMALS = /^\d+(\.\d{1,2})?$/

function roundTrip(s: number): void {
  const b = edgeSatangToBaht(s)
  if (edgeBahtToSatang(b) !== s) throw new Error(`round trip broke at ${s} (baht ${b})`)
  if (!TWO_DECIMALS.test(JSON.stringify(b))) throw new Error(`${s} serialised as ${JSON.stringify(b)}`)
}

describe('edge round trip (spec 04 §4.2)', () => {
  it('every satang 0…1,000,000 survives satang → baht → satang and serialises with ≤ 2 decimals', () => {
    for (let s = 0; s <= 1_000_000; s++) roundTrip(s)
  })
  it('100,000 random values up to the numeric(10,2) ceiling', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: EDGE_MAX_SATANG }), (s) => { roundTrip(s) }), { numRuns: 100_000 })
  })
  it('the last 10,000 values below the ceiling', () => {
    for (let s = EDGE_MAX_SATANG - 10_000; s <= EDGE_MAX_SATANG; s++) roundTrip(s)
  })
  it('serialises like the spec examples', () => {
    expect(JSON.stringify(edgeSatangToBaht(3550))).toBe('35.5')
    expect(JSON.stringify(edgeSatangToBaht(1225))).toBe('12.25')
    expect(JSON.stringify(edgeSatangToBaht(3500))).toBe('35')
    expect(Object.is(edgeSatangToBaht(0), 0)).toBe(true)
  })
})

describe('edgeBahtToSatang', () => {
  it.each([
    [0.1 + 0.2, 30],
    [19.99 * 3, 5997],
    [35 * 1.07, 3745],
    // outputs of dayo round2 for the classic float traps: round2(36.675) = 36.68, round2(1.005) = 1.01
    [36.68, 3668],
    [1.01, 101],
    [0, 0],
    [99_999_999.99, EDGE_MAX_SATANG],
  ])('%s baht → %s satang', (baht, satang) => {
    expect(edgeBahtToSatang(baht)).toBe(satang)
  })
  it('never returns -0', () => {
    expect(Object.is(edgeBahtToSatang(-0), 0)).toBe(true)
  })
  it.each([
    [-0.01, 'NOT_A_MONEY_VALUE'],
    [Number.NaN, 'NOT_A_MONEY_VALUE'],
    [Number.POSITIVE_INFINITY, 'NOT_A_MONEY_VALUE'],
    [35.123, 'MORE_THAN_2_DECIMALS'],
    [36.675, 'MORE_THAN_2_DECIMALS'], // a raw 3-decimal value from dayo is a dayo bug: never rounded away silently
    [1e11, 'OUT_OF_RANGE'],
  ])('%s throws %s', (baht, code) => {
    try { edgeBahtToSatang(baht); expect.unreachable() } catch (e) {
      expect(e).toBeInstanceOf(MoneyEdgeError)
      expect((e as MoneyEdgeError).code).toBe(code)
    }
  })
})

describe('edgeSatangToBaht', () => {
  it.each([[1.5, 'NOT_A_MONEY_VALUE'], [Number.NaN, 'NOT_A_MONEY_VALUE'], [-1, 'OUT_OF_RANGE'], [EDGE_MAX_SATANG + 1, 'OUT_OF_RANGE']])('%s throws %s', (s, code) => {
    try { edgeSatangToBaht(s); expect.unreachable() } catch (e) { expect((e as MoneyEdgeError).code).toBe(code) }
  })
})
