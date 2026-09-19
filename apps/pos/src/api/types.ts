import type { CashMovementKind, UserRole } from '@dayo/contracts'
import type { CashCountLine, CashInputs, SalesSummary, ZSnapshot, ZVoid } from '@dayo/domain'

export const PIN_RE = /^\d{4,6}$/

/** Every free-text reason (void, discount, cash variance, paid-in/out) is at most this many characters (Task 13 M-4 of plan 3). */
export const REASON_MAX_LENGTH = 200

export type UserDto = { id: string; displayName: string; role: UserRole }
export type DeviceDto = { id: string; name: string; receiptPrefix: string }
export type ShiftDto = { id: string; businessDate: string; openedAt: string; openedBy: string; openingFloatSatang: number }
export type BootstrapState = { needsSetup: boolean; device: DeviceDto | null; users: UserDto[]; openShift: ShiftDto | null; pendingSyncItems: number }
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
}

export type CloseShiftInput = {
  /** Signed-in user who counted the drawer. */
  actorUserId: string
  /** Owner who confirms the close with their PIN (spec §5 "ปิดวันต้อง owner" · Q3b-2 · D52). */
  approverUserId: string
  approverPin: string
  countLines: CashCountLine[]
  /** Expected cash the screen showed after the count — refused with SHIFT_CHANGED if the shift moved meanwhile. */
  shownExpectedCashSatang: number
  varianceReason: string | null
  /** PromptPay total read from the bank app for this shift; optional, no threshold (Q3b-12 · D53). */
  bankQrTotalSatang: number | null
  /** true only after a Z_CHAIN_BROKEN refusal, when the owner re-enters their PIN to acknowledge it (Q3b-11 · D53). */
  acknowledgeZChainBroken: boolean
}

export type ZReportDto = { id: string; shiftId: string; createdAt: string; hash: string; hashOk: boolean; snapshot: ZSnapshot }
export type ZReportSummaryDto = {
  shiftId: string
  businessDate: string
  zNo: number
  closedAt: string
  netSalesSatang: number
  cashVarianceSatang: number
  openedQuick: boolean
  hashOk: boolean
  /** This Z was closed after acknowledging a previous Z that failed its hash (Q3b-11 · D53). */
  chainWarning: boolean
}

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
] as const

type MissingMethods = Exclude<keyof PosApi, (typeof POS_API_METHODS)[number]>
export const POS_API_METHODS_COMPLETE: [MissingMethods] extends [never] ? true : MissingMethods = true
