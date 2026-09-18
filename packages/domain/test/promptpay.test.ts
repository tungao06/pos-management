import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { classifyPromptPayId, crc16Ccitt, formatSatangAsBaht, promptPayPayload } from '../src/promptpay.js'

describe('crc16Ccitt', () => {
  it('matches the CRC-16/CCITT-FALSE check value', () => {
    expect(crc16Ccitt('123456789')).toBe('29B1')
  })
  it('rejects non-ASCII input', () => {
    expect(() => crc16Ccitt('ชา')).toThrow(/non-ASCII/)
  })
})

describe('classifyPromptPayId', () => {
  it('classifies phone, national id and e-wallet, ignoring separators', () => {
    expect(classifyPromptPayId('081-234-5678')).toEqual({ kind: 'phone', digits: '0812345678' })
    expect(classifyPromptPayId('1-2345-67890-12-3')).toEqual({ kind: 'national_id', digits: '1234567890123' })
    expect(classifyPromptPayId('123456789012345')).toEqual({ kind: 'ewallet', digits: '123456789012345' })
  })
  it('rejects anything else', () => {
    expect(() => classifyPromptPayId('12345')).toThrow(/PromptPay id/)
    expect(() => classifyPromptPayId('1812345678')).toThrow(/PromptPay id/)
  })
})

describe('formatSatangAsBaht', () => {
  it('formats with exactly two decimals', () => {
    expect(formatSatangAsBaht(4500)).toBe('45.00')
    expect(formatSatangAsBaht(123450)).toBe('1234.50')
    expect(formatSatangAsBaht(5)).toBe('0.05')
  })
})

// Vectors cross-checked against the `promptpay-qr` npm library on 2026-09-17 (the first is its README example).
describe('promptPayPayload', () => {
  it('static QR without amount', () => {
    expect(promptPayPayload('000-000-0000', null)).toBe('00020101021129370016A000000677010111011300660000000005802TH530376463048956')
  })
  it('dynamic QR for a phone number with amount', () => {
    expect(promptPayPayload('0812345678', 4500)).toBe('00020101021229370016A000000677010111011300668123456785802TH5303764540545.0063043AD5')
    expect(promptPayPayload('0812345678', 123450)).toBe('00020101021229370016A000000677010111011300668123456785802TH530376454071234.50630414B2')
  })
  it('dynamic QR for a national id with amount', () => {
    expect(promptPayPayload('1234567890123', 4500)).toBe('00020101021229370016A000000677010111021312345678901235802TH5303764540545.0063041EB1')
  })
  it('rejects a non-positive amount', () => {
    expect(() => promptPayPayload('0812345678', 0)).toThrow(RangeError)
  })
  it('always ends with the CRC of everything before it and carries the amount', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99_999_999 }), (amount) => {
        const p = promptPayPayload('0812345678', amount)
        expect(p.slice(-4)).toBe(crc16Ccitt(p.slice(0, -4)))
        const baht = formatSatangAsBaht(amount)
        expect(p).toContain(`54${String(baht.length).padStart(2, '0')}${baht}`)
      }),
    )
  })
})
