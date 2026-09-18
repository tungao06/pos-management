import { posErrorCode, type PosErrorCode } from '../api/errors'
import { TH } from './th'

const MESSAGES: Record<PosErrorCode, string> = {
  DB_OPEN_FAILED: TH.errDbOpenFailed,
  NEEDS_SETUP: TH.errNeedsSetup,
  ALREADY_SET_UP: TH.errAlreadySetUp,
  BAD_INPUT: TH.errBadInput,
  PIN_WRONG: TH.errPinWrong,
  NOT_OWNER: TH.errNotOwner,
  NO_OPEN_SHIFT: TH.errNoOpenShift,
  SHIFT_ALREADY_OPEN: TH.errShiftAlreadyOpen,
  EMPTY_CART: TH.errEmptyCart,
  NO_PRICE: TH.errNoPrice,
  NO_RECIPE: TH.errNoRecipe,
  TENDER_TOO_LOW: TH.errTenderTooLow,
  DISCOUNT_TOO_BIG: TH.errDiscountTooBig,
  NO_PROMPTPAY_ID: TH.errNoPromptPayId,
  ORDER_NOT_FOUND: TH.errOrderNotFound,
  VOID_NOT_ALLOWED: TH.errVoidNotAllowed,
}

/**
 * Thai message for any error thrown by PosApi (BAD_INPUT keeps its technical detail for troubleshooting).
 * M10: an unrecognized code (a raw DrizzleError, a CHECK failure, …) must never leak English/SQL text onto the
 * screen — it is logged to the console and shown as a generic Thai message; the raw text stays available via
 * `errorDetail` for an optional `<details>` element.
 */
export function errorMessage(e: unknown): string {
  const code = posErrorCode(e)
  const raw = e instanceof Error ? e.message : String(e)
  if (code === null || !(code in MESSAGES)) {
    console.error(e)
    return TH.errUnexpected
  }
  return code === 'BAD_INPUT' ? `${MESSAGES[code]} — ${raw.slice(code.length + 2)}` : MESSAGES[code]
}

/** Raw error text for an optional `<details>` next to `errorMessage` — never the primary on-screen message (M10). */
export function errorDetail(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
