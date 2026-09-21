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
  | 'SHIFT_CHANGED' // closeShift: the expected cash moved after the screen showed it — detail "shown <X>, now <Y>"
  | 'VARIANCE_REASON_REQUIRED' // spec §4.8: over/short above cash.variance_alert_satang
  | 'Z_NOT_FOUND'
  | 'Z_CHAIN_BROKEN' // Q3b-11 · D53: the previous Z fails its hash — detail = its shiftId; retry with acknowledgeZChainBroken
  | 'BACKUP_FAILED'
  | 'PRICE_JUMP' // D47 item 3 · Q4-15: a received price is > 10% off the last purchase price — detail = the item codes; retry with acceptPriceJump
  | 'STOCK_COUNT_NOT_OPEN' // the stock count was closed (or never opened) — reload the count screen
  | 'OPENING_COUNT_INCOMPLETE' // Q4-13 · D30: the opening count must cover every tracked item — detail = the missing codes

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
