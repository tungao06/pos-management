import type { CashMovementKind, UserRole } from '@dayo/contracts'
import type { CashCountLine, CashInputs, SalesSummary, ZSnapshot, ZVoid } from '@dayo/domain'

export const PIN_RE = /^\d{4,6}$/

/** Every free-text reason (void, discount, cash variance, paid-in/out) is at most this many characters (Task 13 M-4 of plan 3). */
export const REASON_MAX_LENGTH = 200

export type UserDto = { id: string; displayName: string; role: UserRole }
export type DeviceDto = { id: string; name: string; receiptPrefix: string }
export type ShiftDto = { id: string; businessDate: string; openedAt: string; openedBy: string; openingFloatSatang: number }
export type BootstrapState = {
  needsSetup: boolean
  device: DeviceDto | null
  users: UserDto[]
  openShift: ShiftDto | null
  pendingSyncItems: number
  /** Export time of the last backup file an owner confirmed as saved (sync_state `local.last_backup_at`), or null. */
  lastBackupAt: string | null
  /** A Z report was closed after the last one a confirmed backup covered — compared by Z id, not time (Q3b-7 · D52). */
  backupDue: boolean
}
export type SetupInput = { deviceName: string; receiptPrefix: string; owners: { displayName: string; pin: string }[]; promptPayId: string }
export type OpenShiftInput = { userId: string; openingFloatSatang: number }
/** "เปิดกะด่วน" (spec §4.8): owner only, float 0 (Q3b-10 · D52). */
export type QuickOpenShiftInput = { userId: string }

export type MenuCategory = { id: string; code: string; name: string }
export type MenuProduct = { id: string; code: string; nameTh: string; nameEn: string; categoryId: string }
export type MenuSize = { id: string; code: string; name: string }
export type MenuSweetness = { id: string; code: string; name: string; isDefault: boolean }
export type MenuVariant = { id: string; productId: string; sizeId: string; priceSatang: number | null }
export type MenuDto = {
  storeChannelId: string
  categories: MenuCategory[]
  products: MenuProduct[]
  sizes: MenuSize[]
  sweetness: MenuSweetness[]
  variants: MenuVariant[]
  defaultSizeId: string
  defaultSweetnessId: string
  bestSellerProductIds: string[]
}

export type CommitSaleInput = {
  /** Created when the cart starts; resending the same id returns the first result (decision T17). */
  orderId: string
  actorUserId: string
  lines: { variantId: string; sweetnessId: string; qty: number }[]
  discount: { amountSatang: number; reason: string } | null
  payment: { method: 'CASH'; tenderedSatang: number } | { method: 'PROMPTPAY' }
  /** The total the customer was shown (cart / QR). commitSale refuses with PRICE_CHANGED if the DB re-price differs (I-7, D50 Q3-27). */
  expectedTotalSatang: number
}
export type CommitSaleResult = {
  orderId: string
  receiptNo: string
  queueNo: number
  businessDate: string
  totalSatang: number
  changeSatang: number | null
  method: 'CASH' | 'PROMPTPAY'
}

export type OrderSummaryDto = {
  id: string
  receiptNo: string
  queueNo: number
  status: 'paid' | 'voided'
  totalSatang: number
  method: 'CASH' | 'PROMPTPAY'
  paidAt: string
  cups: number
}
export type OrderLineDto = { lineNo: number; productName: string; sizeName: string; sweetnessName: string; qty: number; unitPriceSatang: number; lineTotalSatang: number }
export type OrderEventDto = { seq: number; type: string; at: string; actorId: string; payload: unknown }
export type OrderDetailDto = OrderSummaryDto & {
  businessDate: string
  shiftId: string | null
  subtotalSatang: number
  discountSatang: number
  discountReason: string | null
  tenderedSatang: number | null
  changeSatang: number | null
  voidedAt: string | null
  lines: OrderLineDto[]
  events: OrderEventDto[]
  voidable: boolean
}

export type VoidOrderInput = {
  orderId: string
  /** Signed-in user who performs the void. */
  actorUserId: string
  /** Owner who approves with their PIN (spec §4.3). */
  approverUserId: string
  approverPin: string
  reason: string
  /** "ทำเครื่องดื่มไปแล้วหรือยัง" — true = made (waste), false = return ingredients. */
  made: boolean
  /** Required when the order was paid by PromptPay (D48 Q3-15). */
  refundReference: string | null
}

/** A paid-in / paid-out / drop typed in by a person (spec §3.5 · Q3b-9 · D52). VOID_REFUND is written by voidOrder only. */
export type CashMovementInput = { actorUserId: string; kind: 'PAID_IN' | 'PAID_OUT' | 'DROP'; amountSatang: number; reason: string }
export type CashMovementDto = { id: string; kind: CashMovementKind; amountSatang: number; orderId: string | null; reason: string | null; createdBy: string; createdAt: string }

/** A tracked base (prepared item) whose stock went negative — shown before closing the shift (D28). */
export type NegativeBaseDto = { itemId: string; code: string; name: string; useUnit: string; onHandMilli: number }

/** X report: the open shift computed live, any time (spec §4.8). */
export type ShiftReportDto = {
  shift: ShiftDto & { openedByName: string; openedQuick: boolean }
  generatedAt: string
  sales: SalesSummary
  cash: CashInputs
  expectedCashSatang: number
  varianceAlertSatang: number
  cashMovements: CashMovementDto[]
  voids: ZVoid[]
  negativeBases: NegativeBaseDto[]
  pendingSyncItems: number
  /** `shiftReportFingerprint` of every other field above except this one (Q3b-17 · D54, review NF-6) — the
   * close-shift screen (Task 11) echoes this straight into `CloseShiftInput.shownReportFingerprint`, with no need
   * to import the helper (or drizzle/@dayo/db-schema through it) itself. */
  fingerprint: string
}

export type CloseShiftInput = {
  /** Signed-in user who counted the drawer. */
  actorUserId: string
  /** Owner who confirms the close with their PIN (spec §5 "ปิดวันต้อง owner" · Q3b-2 · D52). */
  approverUserId: string
  approverPin: string
  countLines: CashCountLine[]
  /** Expected cash the screen showed after the count — kept for a readable SHIFT_CHANGED detail ("shown X, now Y");
   * `shownReportFingerprint` is what actually guards every figure (Q3b-17 · D54). */
  shownExpectedCashSatang: number
  /** `shiftReportFingerprint` of the X report the screen showed (Q3b-17 · D54, review m-1) — refused with
   * SHIFT_CHANGED on any mismatch (sales, cash, QR or voids moved), not only when expected cash itself moved.
   * Task 11 (the close-shift screen) computes this from the same `shiftReport()` call it displays. */
  shownReportFingerprint: string
  varianceReason: string | null
  /** PromptPay total read from the bank app for this shift; optional, no threshold (Q3b-12 · D53). */
  bankQrTotalSatang: number | null
  /** true only after a Z_CHAIN_BROKEN refusal, when the owner re-enters their PIN to acknowledge it (Q3b-11 · D53). */
  acknowledgeZChainBroken: boolean
}

/**
 * `snapshot` is null when `snapshot_json` cannot be read as a Z snapshot — invalid JSON, or valid JSON missing
 * `sales` (review I-1). `hashOk` is then always false: a snapshot the UI cannot read is never trusted. The UI
 * (Task 9) must show "ไฟล์เสีย" rather than assume `snapshot` is present.
 */
export type ZReportDto = { id: string; shiftId: string; createdAt: string; hash: string; hashOk: boolean; snapshot: ZSnapshot | null }
/** Summary fields are null when the underlying snapshot could not be read (review I-1) — `hashOk` says so; `shiftId` and `hashOk` are always readable from their own columns. */
export type ZReportSummaryDto = {
  shiftId: string
  businessDate: string | null
  zNo: number | null
  closedAt: string | null
  netSalesSatang: number | null
  cashVarianceSatang: number | null
  openedQuick: boolean | null
  hashOk: boolean
  /** This Z was closed after acknowledging a previous Z that failed its hash (Q3b-11 · D53); false when unreadable. */
  chainWarning: boolean
}

/** The raw SQLite file of this device (spec §11 · spike I3 `exportFile`) and the latest Z it contains. */
export type BackupFileDto = { fileName: string; bytes: Uint8Array; createdAt: string; lastZId: string | null }
/** The owner saw the exported file in Downloads (review I-4) — echoes the BackupFileDto without its bytes. */
export type ConfirmBackupInput = { actorUserId: string; fileName: string; byteLength: number; createdAt: string; lastZId: string | null }

/** Everything the UI may ask of the on-device database. Implemented in the Worker (and in Node tests). */
export interface PosApi {
  bootstrap(): Promise<BootstrapState>
  setupShop(input: SetupInput): Promise<void>
  login(userId: string, pin: string): Promise<UserDto>
  openShift(input: OpenShiftInput): Promise<ShiftDto>
  loadMenu(): Promise<MenuDto>
  commitSale(input: CommitSaleInput): Promise<CommitSaleResult>
  listOrders(): Promise<OrderSummaryDto[]>
  getOrder(orderId: string): Promise<OrderDetailDto>
  promptPayForAmount(amountSatang: number): Promise<string>
  voidOrder(input: VoidOrderInput): Promise<OrderDetailDto>
  quickOpenShift(input: QuickOpenShiftInput): Promise<ShiftDto>
  recordCashMovement(input: CashMovementInput): Promise<CashMovementDto>
  shiftReport(): Promise<ShiftReportDto>
  closeShift(input: CloseShiftInput): Promise<ZReportDto>
  listZReports(): Promise<ZReportSummaryDto[]>
  getZReport(shiftId: string): Promise<ZReportDto>
  exportBackup(actorUserId: string): Promise<BackupFileDto>
  confirmBackupSaved(input: ConfirmBackupInput): Promise<void>
}

/** Method names exposed through Comlink — must list every PosApi method (checked below). */
export const POS_API_METHODS = [
  'bootstrap',
  'setupShop',
  'login',
  'openShift',
  'loadMenu',
  'commitSale',
  'listOrders',
  'getOrder',
  'promptPayForAmount',
  'voidOrder',
  'quickOpenShift',
  'recordCashMovement',
  'shiftReport',
  'closeShift',
  'listZReports',
  'getZReport',
  'exportBackup',
  'confirmBackupSaved',
] as const

type MissingMethods = Exclude<keyof PosApi, (typeof POS_API_METHODS)[number]>
export const POS_API_METHODS_COMPLETE: [MissingMethods] extends [never] ? true : MissingMethods = true
