import { posErrorCode, type PosErrorCode } from '../api/errors'
import { TH } from './th'

const MESSAGES: Record<PosErrorCode, string> = {
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
  Z_CHAIN_BROKEN: TH.errZChainBroken,
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
  return code === 'BAD_INPUT' ? `${MESSAGES[code]} — ${raw.slice(code.length + 2)}` : MESSAGES[code]
}
