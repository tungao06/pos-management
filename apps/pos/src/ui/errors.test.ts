import { describe, expect, it } from 'vitest'
import { PosError, type PosErrorCode } from '../api/errors'
import { errorMessage, MESSAGES } from './errors'
import { TH } from './th'

// `MESSAGES` is typed `Record<PosErrorCode, string>` (ui/errors.ts), so a code stream C adds to `PosErrorCode`
// without a Thai message here already fails to typecheck. This test re-checks it at runtime, walking every key
// `MESSAGES` actually declares, so the failure reads as a normal test failure rather than only a type error.
describe('ui/errors — every PosErrorCode has Thai text (Task 17 review item 10)', () => {
  const detailOf = (code: PosErrorCode): string => (code === 'PIN_LOCKED' ? '30' : 'detail')

  for (const code of Object.keys(MESSAGES) as PosErrorCode[]) {
    it(`${code} → readable Thai, not the generic fallback`, () => {
      const message = errorMessage(new PosError(code, detailOf(code)))
      expect(message.length).toBeGreaterThan(0)
      expect(message).not.toBe(TH.errUnexpected)
      expect(/[ก-๙]/.test(message)).toBe(true) // contains Thai script — never a raw English/SQL leak
    })
  }
})

// Pins the "ปรับตาม dayo" corrected wording (task-17-brief.md) so a future edit cannot silently drop the value
// or the sentence.
describe('DAYO_RECEIPT_NO_INVALID wording ("ปรับตาม dayo")', () => {
  it('names the exact value dayo sent and keeps the corrected sentence', () => {
    const message = errorMessage(new PosError('DAYO_RECEIPT_NO_INVALID', 'B-000311'))
    expect(message).toContain('B-000311')
    expect(message).toBe(TH.dayoReceiptNoInvalid('B-000311'))
    expect(message).toBe('เลขใบเสร็จล่าสุดที่ระบบกลางจำไว้ (B-000311) ไม่ใช่รูปแบบของแท็บเล็ต — ให้เจ้าของตรวจกุญแจเครื่องบนเว็บ dayo')
  })
})

// M2 (fix round 1, security): dayo's raw last_receipt_no reaches this message unescaped — a bidi override (or any
// other control/format character) in it must never reach the screen, and the value is bounded so a malicious
// central server cannot use it to push arbitrarily long text into the UI.
describe('DAYO_RECEIPT_NO_INVALID sanitizes its value (M2, fix round 1)', () => {
  it('strips a Unicode bidi override (U+202E) and any other \\p{C} character', () => {
    const message = errorMessage(new PosError('DAYO_RECEIPT_NO_INVALID', 'B-‮000311‬'))
    expect(message).not.toContain('‮')
    expect(message).not.toContain('‬')
    expect(message).toContain('B-000311')
  })

  it('cuts the value to 32 characters', () => {
    const long = `A-${'9'.repeat(200)}`
    const message = errorMessage(new PosError('DAYO_RECEIPT_NO_INVALID', long))
    const shown = /\(([^)]*)\)/.exec(message)?.[1] ?? ''
    expect(shown.length).toBeLessThanOrEqual(32)
    expect(message).not.toContain(long)
  })
})

// block 3 Task 1: error codes for shifts/cash/Z (spec 04 §6.4, §6.8, §7 ข้อ 5–6 · D97)
describe('block 3 shift/cash/Z error codes have Thai text', () => {
  it.each(['COUNT_PENDING', 'SHIFT_NOT_COUNTING', 'Z_NOT_READY', 'BOT_CASH_REQUIRED', 'DAYO_Z_STATE_INVALID', 'Z_TOO_LARGE', 'OFF_CATALOG_NOT_POSSIBLE'] as const)('%s has Thai text', (code) => {
    const text = errorMessage(new Error(`${code}: x`))
    expect(text).not.toBe(TH.errUnexpected)
    expect(text).toMatch(/[฀-๿]/)
  })

  it("DAYO_Z_STATE_INVALID strips control characters from dayo's raw value", () => {
    expect(errorMessage(new Error('DAYO_Z_STATE_INVALID: 4‮1'))).toBe(TH.dayoZStateInvalid('41'))
  })
})
