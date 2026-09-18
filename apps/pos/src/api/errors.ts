export type PosErrorCode =
  | 'DB_OPEN_FAILED'
  | 'NEEDS_SETUP'
  | 'ALREADY_SET_UP'
  | 'BAD_INPUT'
  | 'PIN_WRONG'
  | 'PIN_LOCKED' // D50 Q3-21 — detail is the whole seconds left
  | 'NOT_OWNER'
  | 'NO_OPEN_SHIFT'
  | 'SHIFT_ALREADY_OPEN'
  | 'EMPTY_CART'
  | 'NO_PRICE'
  | 'NO_RECIPE'
  | 'TENDER_TOO_LOW'
  | 'DISCOUNT_TOO_BIG'
  | 'PRICE_CHANGED' // D50 Q3-27 — detail "shown <X>, now <Y>"
  | 'NO_PROMPTPAY_ID'
  | 'ORDER_NOT_FOUND'
  | 'VOID_NOT_ALLOWED'

/** Comlink forwards only name/message/stack, so the code travels as a "CODE: " message prefix. */
export class PosError extends Error {
  readonly code: PosErrorCode
  constructor(code: PosErrorCode, detail: string) {
    super(`${code}: ${detail}`)
    this.name = 'PosError'
    this.code = code
  }
}

export function posErrorCode(e: unknown): PosErrorCode | null {
  const message = e instanceof Error ? e.message : ''
  const m = /^([A-Z_]+): /.exec(message)
  return m ? (m[1] as PosErrorCode) : null
}
