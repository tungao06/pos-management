import { describe, expect, it } from 'vitest'
import { formatBaht, parseBahtInput } from './format'

describe('formatBaht', () => {
  it('hides zero satang, keeps two digits otherwise, groups thousands', () => {
    expect(formatBaht(4500)).toBe('฿45')
    expect(formatBaht(4550)).toBe('฿45.50')
    expect(formatBaht(4505)).toBe('฿45.05')
    expect(formatBaht(123_456_700)).toBe('฿1,234,567')
    expect(formatBaht(0)).toBe('฿0')
    expect(formatBaht(-500)).toBe('-฿5')
  })
})

describe('parseBahtInput', () => {
  it('parses whole baht and up to two decimals into satang', () => {
    expect(parseBahtInput('45')).toBe(4500)
    expect(parseBahtInput('45.5')).toBe(4550)
    expect(parseBahtInput('45.05')).toBe(4505)
    expect(parseBahtInput(' 1000 ')).toBe(100_000)
    expect(parseBahtInput('0')).toBe(0)
  })
  it('rejects anything else', () => {
    for (const bad of ['', 'abc', '1.234', '-5', '1,000', '45.', '.5']) expect(parseBahtInput(bad)).toBeNull()
  })
})
