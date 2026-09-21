import { describe, expect, it } from 'vitest'
import { formatQty, parseQtyInput } from './format'

describe('formatQty', () => {
  it('shows milli-units as units, trimming trailing zeros, grouping thousands', () => {
    expect(formatQty(1_400_000, 'g')).toBe('1,400 g')
    expect(formatQty(16_600, 'ml')).toBe('16.6 ml')
    expect(formatQty(-130_000, 'ml')).toBe('-130 ml')
    expect(formatQty(3_500, 'ถุง')).toBe('3.5 ถุง')
    expect(formatQty(1, 'g')).toBe('0.001 g')
    expect(formatQty(0, 'ชิ้น')).toBe('0 ชิ้น')
  })
})

describe('parseQtyInput', () => {
  it('parses whole units and up to three decimals into milli-units', () => {
    expect(parseQtyInput('3.5')).toBe(3_500)
    expect(parseQtyInput(' 12 ')).toBe(12_000)
    expect(parseQtyInput('0.125')).toBe(125)
    expect(parseQtyInput('0')).toBe(0)
    expect(parseQtyInput('9999.999')).toBe(9_999_999)
  })
  it('rejects anything else', () => {
    for (const bad of ['', 'abc', '1.2345', '-1', '1,000', '10000', '.5', '5.']) expect(parseQtyInput(bad)).toBeNull()
  })
})
