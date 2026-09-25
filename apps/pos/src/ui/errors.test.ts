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
