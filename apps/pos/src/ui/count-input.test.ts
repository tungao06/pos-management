import { describe, expect, it } from 'vitest'
import { parseCountInput } from './format'

describe('parseCountInput', () => {
  it('empty is 0; whole numbers up to 99999', () => {
    expect(parseCountInput('')).toBe(0)
    expect(parseCountInput('  ')).toBe(0)
    expect(parseCountInput('7')).toBe(7)
    expect(parseCountInput(' 012 ')).toBe(12)
    expect(parseCountInput('99999')).toBe(99_999)
  })
  it('rejects anything else', () => {
    for (const bad of ['-1', '1.5', 'abc', '100000', '1,000']) expect(parseCountInput(bad)).toBeNull()
  })
})
