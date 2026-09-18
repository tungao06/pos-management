import { assertSafeInt } from './money.js'

const AID_PROMPTPAY = 'A000000677010111'

function tlv(id: string, value: string): string {
  if (value.length > 99) throw new RangeError(`EMV field ${id} too long`)
  return `${id}${String(value.length).padStart(2, '0')}${value}`
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) as 4 uppercase hex digits — the EMVCo QR checksum. ASCII only. */
export function crc16Ccitt(s: string): string {
  let crc = 0xffff
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code > 0x7f) throw new RangeError('crc16Ccitt: non-ASCII input')
    crc ^= code << 8
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

export type PromptPayIdKind = 'phone' | 'national_id' | 'ewallet'

/** Phone = 10 digits starting with 0 · national/tax id = 13 digits · e-wallet = 15 digits. Separators are ignored. */
export function classifyPromptPayId(id: string): { kind: PromptPayIdKind; digits: string } {
  const digits = id.replace(/[^0-9]/g, '')
  if (digits.length === 10 && digits.startsWith('0')) return { kind: 'phone', digits }
  if (digits.length === 13) return { kind: 'national_id', digits }
  if (digits.length === 15) return { kind: 'ewallet', digits }
  throw new RangeError(`PromptPay id must be a 10-digit phone starting with 0, a 13-digit national/tax id or a 15-digit e-wallet id (got ${digits.length} digits)`)
}

/** 4500 → "45.00" (integer arithmetic only). */
export function formatSatangAsBaht(satang: number): string {
  assertSafeInt(satang, 'satang')
  if (satang < 0) throw new RangeError('amount must be >= 0')
  return `${Math.floor(satang / 100)}.${String(satang % 100).padStart(2, '0')}`
}

/**
 * EMVCo merchant-presented QR payload for Thai PromptPay (spec §5, D7).
 * `amountSatang === null` → static QR (point of initiation 11, no amount) · otherwise dynamic QR (12) with Tag 54 amount.
 */
export function promptPayPayload(id: string, amountSatang: number | null): string {
  const { kind, digits } = classifyPromptPayId(id)
  if (amountSatang !== null) {
    assertSafeInt(amountSatang, 'amountSatang')
    if (amountSatang <= 0) throw new RangeError('amountSatang must be > 0')
  }
  const account = kind === 'phone' ? tlv('01', `0066${digits.slice(1)}`) : tlv(kind === 'national_id' ? '02' : '03', digits)
  const fields = [
    tlv('00', '01'),
    tlv('01', amountSatang === null ? '11' : '12'),
    tlv('29', tlv('00', AID_PROMPTPAY) + account),
    tlv('58', 'TH'),
    tlv('53', '764'),
  ]
  if (amountSatang !== null) fields.push(tlv('54', formatSatangAsBaht(amountSatang)))
  const body = `${fields.join('')}6304`
  return body + crc16Ccitt(body)
}
