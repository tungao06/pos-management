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
  if (code === 'DAYO_RECEIPT_NO_INVALID') {
    const value = raw.slice(code.length + 2)
    return value === '' ? MESSAGES[code] : TH.dayoReceiptNoInvalid(value)
  }
  // m-3 (Task 12 fix round 1): closeStockCount sends the missing item codes as the detail (stock-count.ts) — shown
  // here so a ~38-row opening count does not need a scroll-and-guess to find what is still uncounted.
  if (code === 'BAD_INPUT' || code === 'OPENING_COUNT_INCOMPLETE') return `${MESSAGES[code]} — ${raw.slice(code.length + 2)}`
  return MESSAGES[code]
}
