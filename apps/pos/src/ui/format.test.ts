import { describe, expect, it } from 'vitest'
import { formatBaht, formatThaiDate, parseBahtInput } from './format'

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

describe('formatThaiDate', () => {
  it('formats a business date as day · Thai short month · พ.ศ.', () => {
    expect(formatThaiDate('2026-09-25')).toBe('25 ก.ย. 2569')
    expect(formatThaiDate('2026-01-01')).toBe('1 ม.ค. 2569')
  })
  it('returns the raw text unchanged for anything not YYYY-MM-DD (fix round 1 item 11: never crash the banner)', () => {
    expect(formatThaiDate('2026-09-25T00:00:00Z')).toBe('2026-09-25T00:00:00Z')
    expect(formatThaiDate('bad')).toBe('bad')
    expect(formatThaiDate('2026-13-01')).toBe('2026-13-01') // no such month
  })
})
