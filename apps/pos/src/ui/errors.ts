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
  BACKUP_FAILED: TH.errBackupFailed,
  Z_CHAIN_BROKEN: TH.errZChainBroken,
  PRICE_JUMP: TH.errPriceJump,
  STOCK_COUNT_NOT_OPEN: TH.errStockCountNotOpen,
  OPENING_COUNT_INCOMPLETE: TH.errOpeningCountIncomplete,
  // Task 11 codes — placeholder Thai text so the Record stays complete; Task 17 (stream D) moves them into th.ts
  DAYO_BAD_KEY: 'กุญแจไม่ถูกต้องหรือถูกยกเลิก',
  DAYO_KEY_NO_SCOPE: 'กุญแจนี้ไม่มีสิทธิ์อ่านเมนู/พนักงาน',
  DAYO_API_DISABLED: 'ระบบกลางปิด API อยู่',
  DAYO_UNREACHABLE: 'ติดต่อระบบกลางไม่ได้ — ต้องออนไลน์ตอนตั้งเครื่อง',
  DAYO_BAD_RESPONSE: 'ระบบกลางตอบรูปแบบที่เครื่องนี้อ่านไม่ได้ — แจ้งทีม POS',
  DAYO_RECEIPT_NO_INVALID: 'เลขใบเสร็จล่าสุดจากระบบกลางอ่านไม่ได้ — แจ้งทีม POS',
  NO_CATALOG: 'ยังไม่มีเมนูจากระบบกลาง — ต่อเน็ตแล้วกด "ส่งตอนนี้"',
  RECOVERY_NOT_ALLOWED: "ยังมีเจ้าของที่ใช้ PIN อนุมัติได้ — ใช้ 'เปลี่ยนกุญแจ' ที่หน้าสถานะ",
  KEY_NOT_NEW: 'นี่คือกุญแจเดิม — ออกกุญแจใหม่บนเว็บ',
  OLD_KEY_STILL_ACTIVE: 'ยังไม่ได้เพิกถอนกุญแจเก่าบนเว็บ — เพิกถอนก่อนแล้วกดอีกครั้ง',
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
  // m-3 (Task 12 fix round 1): closeStockCount sends the missing item codes as the detail (stock-count.ts) — shown
  // here so a ~38-row opening count does not need a scroll-and-guess to find what is still uncounted.
  if (code === 'BAD_INPUT' || code === 'OPENING_COUNT_INCOMPLETE') return `${MESSAGES[code]} — ${raw.slice(code.length + 2)}`
  return MESSAGES[code]
}
