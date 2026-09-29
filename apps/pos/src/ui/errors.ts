import type { CartError, CartErrorCode } from '@dayo/domain'
import { posErrorCode, type PosErrorCode } from '../api/errors'
import { TH } from './th'

// Exported for `ui/errors.test.ts` (Task 17 review item 10) — it walks every key here to check `errorMessage`
// gives each `PosErrorCode` readable Thai text; `Record<PosErrorCode, string>` already forces every code to
// have an entry at the type level, so a code stream C adds without a message here fails to typecheck too.
export const MESSAGES: Record<PosErrorCode, string> = {
  DB_OPEN_FAILED: TH.errDbOpenFailed,
  NEEDS_SETUP: TH.errNeedsSetup,
  ALREADY_SET_UP: TH.errAlreadySetUp,
  BAD_INPUT: TH.errBadInput,
  PIN_WRONG: TH.errPinWrong,
  PIN_LOCKED: TH.errPinLocked,
  NOT_OWNER: TH.errNotOwner,
  NO_OPEN_SHIFT: TH.errNoOpenShift,
  SHIFT_ALREADY_OPEN: TH.errShiftAlreadyOpen,
  EMPTY_CART: TH.errEmptyCart,
  NO_PRICE: TH.errNoPrice,
  NO_RECIPE: TH.errNoRecipe,
  TENDER_TOO_LOW: TH.errTenderTooLow,
  DISCOUNT_TOO_BIG: TH.errDiscountTooBig,
  PRICE_CHANGED: TH.errPriceChanged,
  NO_PROMPTPAY_ID: TH.errNoPromptPayId,
  ORDER_NOT_FOUND: TH.errOrderNotFound,
  VOID_NOT_ALLOWED: TH.errVoidNotAllowed,
  SHIFT_CHANGED: TH.errShiftChanged,
  VARIANCE_REASON_REQUIRED: TH.errVarianceReasonRequired,
  Z_NOT_FOUND: TH.errZNotFound,
  BACKUP_FAILED: TH.errBackupFailed,
  Z_CHAIN_BROKEN: TH.errZChainBroken,
  PRICE_JUMP: TH.errPriceJump,
  STOCK_COUNT_NOT_OPEN: TH.errStockCountNotOpen,
  OPENING_COUNT_INCOMPLETE: TH.errOpeningCountIncomplete,
  // Task 11 codes — Thai text now lives in th.ts (Task 17, review item 10)
  DAYO_BAD_KEY: TH.dayoBadKey,
  DAYO_KEY_NO_SCOPE: TH.dayoNoScope,
  DAYO_API_DISABLED: TH.dayoApiOff,
  DAYO_UNREACHABLE: TH.dayoUnreachable,
  DAYO_BAD_RESPONSE: TH.dayoBadResponse,
  // fallback only — the raw last_receipt_no value is unparsable here, so the special case below (which has the
  // detail) is what actually renders; this entry exists only to keep the Record complete.
  DAYO_RECEIPT_NO_INVALID: TH.dayoBadResponse,
  NO_CATALOG: TH.noCatalog,
  // controller ruling R1 (security): recovery only ever targets the address already stored on this tablet.
  RECOVERY_NOT_ALLOWED: TH.recoveryNotAllowed,
  KEY_NOT_NEW: TH.keyNotNew,
  OLD_KEY_STILL_ACTIVE: TH.oldKeyStillActive,
  // Task 18: dayo's pricing code refused the cart, or the queue/payment method could not be used.
  PRICE_NOT_OK: 'ระบบกลางคิดราคาบิลนี้ไม่ได้ — ลบหรือแก้บรรทัดที่ขึ้นเตือนในตะกร้าก่อนชำระ',
  NO_PAYMENT_METHOD: 'ระบบกลางไม่ได้เปิดใช้วิธีชำระเงินนี้ — เลือกวิธีอื่น',
  QUEUE_FULL: 'เลขคิววันนี้ครบ 9999 แล้ว — ต้องเปิดกะใหม่จึงขายต่อได้',
  // Task 15: owner remedies on "ส่งไม่ผ่าน" and the online-only E3 lists
  REMEDY_NOT_ALLOWED: 'ใช้ทางแก้นี้กับรายการนี้ไม่ได้ — โหลดหน้า "ส่งไม่ผ่าน" ใหม่แล้วเลือกปุ่มที่มีให้',
  OFFLINE: 'ต่อระบบกลางไม่ได้ตอนนี้ — ต้องออนไลน์จึงดูรายการนี้ได้ ลองใหม่อีกครั้ง',
  // block 3 shifts/cash/Z (Task 1 · spec 04 §6.4, §6.8, §7 ข้อ 5–6 · D97)
  COUNT_PENDING: TH.errCountPending,
  SHIFT_NOT_COUNTING: TH.errShiftNotCounting,
  Z_NOT_READY: TH.errZNotReady,
  BOT_CASH_REQUIRED: TH.errBotCashRequired,
  // fallback only — the raw last_z_no is unparsable here, so the special case below (which has the detail) is
  // what actually renders; this entry exists only to keep the Record complete.
  DAYO_Z_STATE_INVALID: TH.dayoZStateInvalidGeneric,
  Z_TOO_LARGE: TH.errZTooLarge,
  OFF_CATALOG_NOT_POSSIBLE: TH.errOffCatalogNotPossible,
  // plan 10 T0 — manual promotions + rule-engine catalogs
  MANUAL_REASON_REQUIRED: TH.errManualReasonRequired,
  MANUAL_PROMO_UNSUPPORTED: TH.errManualPromoUnsupported,
  ZERO_TOTAL_NOT_ALLOWED: TH.errZeroTotalNotAllowed,
}

/** dayo's `CartError` code → Thai. `UNKNOWN_VARIANT` is refined by `CartError.reason` below (never by parsing the
 * message text — review round 2 item 6). Used for both the combined `cart-error` banner and each per-line label
 * (review round 2 item 4 — one function, so the two can never show a contradicting Thai message for the same error). */
const CART_ERROR_MESSAGES: Record<CartErrorCode, string> = {
  EMPTY_CART: TH.errEmptyCart,
  CART_TOO_LARGE: TH.errCartTooLarge,
  QTY_OUT_OF_RANGE: TH.errQtyOutOfRange,
  // ADR-0054: a line whose size dayo has since closed for sale — the tablet must never price or send it.
  UNKNOWN_VARIANT: TH.errSizeClosed,
  GRADE_RULE: TH.errGradeRule,
  BAD_DISCOUNT: TH.errBadInput,
  BAD_MANUAL_PROMOTION: TH.errBadManualPromotion,
}

/**
 * Thai message for a `CartError` — from `usePricedCart`'s `error` (the whole cart) or a per-line `checkLine` check
 * (review I5/round 2 item 4). `UNKNOWN_VARIANT` reads differently for a menu dayo removed entirely
 * (`reason: 'no_such_menu'`) than for a size the shop merely closed (`reason: 'size_closed'`) — switched on the
 * structured field, never the free-text detail (round 2 item 6).
 */
export function cartErrorMessage(e: CartError): string {
  if (e.code === 'UNKNOWN_VARIANT') return e.reason === 'no_such_menu' ? TH.errMenuGone : TH.errSizeClosed
  return CART_ERROR_MESSAGES[e.code] ?? TH.errUnexpected
}

/**
 * Thai message for any error thrown by PosApi (BAD_INPUT keeps its technical detail for troubleshooting).
 * M10: an unrecognized code (a raw DrizzleError, a CHECK failure, …) must never leak English/SQL text onto the
 * screen — it is logged to the console and shown as a generic Thai message.
 */
export function errorMessage(e: unknown): string {
  const code = posErrorCode(e)
  const raw = e instanceof Error ? e.message : String(e)
  if (code === null || !(code in MESSAGES)) {
    console.error(e)
    return TH.errUnexpected
  }
  if (code === 'PIN_LOCKED') {
    const seconds = Number(raw.slice(code.length + 2))
    return Number.isInteger(seconds) && seconds > 0 ? TH.errPinLockedFor(seconds) : MESSAGES[code]
  }
  // "ปรับตาม dayo": the detail is dayo's raw client.last_receipt_no (never a secret) — named so the owner can
  // check the tablet's key against the right device on the dayo web instead of guessing from a shape description.
  // M2 (fix round 1, security): it is dayo's own text, unescaped — a bidi override or any other control/format
  // character in it must never reach the screen, and it is bounded so a hostile answer cannot push arbitrary
  // length into the UI. Stripped before it is ever interpolated into the message.
  if (code === 'DAYO_RECEIPT_NO_INVALID') {
    const value = raw.slice(code.length + 2).replace(/\p{C}/gu, '').slice(0, 32)
    return value === '' ? MESSAGES[code] : TH.dayoReceiptNoInvalid(value)
  }
  // m-3 (Task 12 fix round 1): closeStockCount sends the missing item codes as the detail (stock-count.ts) — shown
  // here so a ~38-row opening count does not need a scroll-and-guess to find what is still uncounted.
  if (code === 'BAD_INPUT' || code === 'OPENING_COUNT_INCOMPLETE') return `${MESSAGES[code]} — ${raw.slice(code.length + 2)}`
  // Task 19: cancelSale's VOID_NOT_ALLOWED carries a structured reason prefix (void.ts) for the two cases Q44/ruling
  // R11 actually distinguishes — matched by the prefix, never by parsing dayo/void.ts's own Thai text as free text.
  if (code === 'VOID_NOT_ALLOWED') {
    if (raw.startsWith(`${code}: SAME_DAY_ONLY:`)) return TH.errVoidSameDayOnly
    if (raw.startsWith(`${code}: OWN_BILLS_ONLY:`)) return TH.errVoidOwnBillsOnly
    return MESSAGES[code]
  }
  // block 3 Task 1: dayo's raw last_z_no, sanitized the same way as DAYO_RECEIPT_NO_INVALID above (M2).
  if (code === 'DAYO_Z_STATE_INVALID') {
    const value = raw.slice(code.length + 2).replace(/\p{C}/gu, '').slice(0, 32)
    return value === '' ? MESSAGES[code] : TH.dayoZStateInvalid(value)
  }
  return MESSAGES[code]
}
