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
  // block 2 Task 11 — connecting to dayo (Thai messages: Task 17, ui/errors.ts)
  | 'DAYO_BAD_KEY' // E1 answered 401: wrong or revoked key
  | 'DAYO_KEY_NO_SCOPE' // E1 answered 403: the key lacks catalog:read / staff:read
  | 'DAYO_API_DISABLED' // E1 answered 404: API_V1_ENABLED is off
  | 'DAYO_UNREACHABLE' // offline, timeout, 5xx, 429 — setup must be online
  | 'DAYO_BAD_RESPONSE' // an answer that breaks the contract, or a catalog this tablet cannot sell with
  | 'DAYO_RECEIPT_NO_INVALID' // client.last_receipt_no is not <A-Z{1,3}>-<6 digits> (spec §4.4 ข้อ 6 · A1)
  | 'NO_CATALOG' // no catalog from dayo on this tablet yet
  | 'RECOVERY_NOT_ALLOWED' // ruling N2: an owner with a PIN can still approve and the key works — use replaceApiKey
  | 'KEY_NOT_NEW' // recoverOwner was given the key already stored
  | 'OLD_KEY_STILL_ACTIVE' // recoverOwner: dayo does not refuse the old key yet (revoke it on the web first)
  // block 2 selling with dayo's catalog (spec 04 §4.5, §5.1)
  | 'PRICE_NOT_OK' // dayo's pricing code refused the cart (unknown channel/code, closed promotion…) — detail = its warnings
  | 'NO_PAYMENT_METHOD' // the catalog from dayo does not offer this payment method (cash / qr)
  | 'QUEUE_FULL' // queue number 9999 was reached on this business day (ruling R13)
  // block 2 Task 15 — owner remedies and E3 (spec 04 §4.6, §6.4)
  | 'REMEDY_NOT_ALLOWED' // the row is not on the "ส่งไม่ผ่าน" page, or this fix does not fit its reason
  | 'OFFLINE' // E3 (bot/web bills, dayo edits) needs dayo now: offline, refused key, API off, rate limit — detail = why
  // block 3 shifts/cash/Z (spec 04 §6.4, §6.8, §7 ข้อ 5–6 · D97)
  | 'COUNT_PENDING' // R2: a shift of this device is 'counting' (นับเสร็จ แต่ยังไม่ยืนยัน) — confirm it before opening a new one
  | 'SHIFT_NOT_COUNTING' // confirmCount/countSummary on a shift that is not counting/counted — detail = shiftId
  | 'Z_NOT_READY' // R7: issueZ while an earlier counted shift has no Z yet, or the count is not confirmed — detail = that shiftId
  | 'BOT_CASH_REQUIRED' // D68/§6.8: the Z of a central shift needs E4 bot cash (fetchBotCash first, online)
  | 'DAYO_Z_STATE_INVALID' // §4.4 ข้อ 6: client.last_z_no/last_z_hash/last_z_until unreadable — detail = the raw last_z_no
  | 'Z_TOO_LARGE' // R20: > 2000 POS bills / > 500 bot bills / > 500 cash movements in one Z
  | 'OFF_CATALOG_NOT_POSSIBLE' // R10/R11: this bill cannot be closed as off-catalog (use "ปิดไว้ในเครื่อง")

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

/**
 * Task 14 · carried item 9b (Task 16): `BAD_INPUT` whose detail starts with `CLOCK_AHEAD:` (rows.ts
 * `clockAheadError`) — the tablet's own last count is more than 24 h ahead of the real time, floor-blocking every
 * later count and Z until the owner skips it (`skipCountFloor`). Matched on the structured detail prefix, never by
 * parsing the rest of the Thai text as free text (same rule as every other prefixed detail in this app).
 */
export function isClockAheadCountError(e: unknown): boolean {
  return posErrorCode(e) === 'BAD_INPUT' && e instanceof Error && e.message.startsWith('BAD_INPUT: CLOCK_AHEAD:')
}
