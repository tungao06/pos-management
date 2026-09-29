import type { AdjustReason, CashMovementKind, MovementKind, ShiftSyncMode, UseUnit, UserRole } from '@dayo/contracts'
import type { Size, Sweetness } from '@dayo/dayo-pricing'
import type { SyncCycleResult } from '../sync/scheduler'
import type { ApiState } from '../sync/state'
import type { CartDraft, CashCountLine, CashInputs, ExpiryState, PosOrderCatalog, SalesSummary, StockStatus, ZBotBill, ZSnapshot, ZVoid } from '@dayo/domain'

export const PIN_RE = /^\d{4,6}$/

/** Every free-text reason (void, discount, cash variance, paid-in/out) is at most this many characters (Task 13 M-4 of plan 3). */
export const REASON_MAX_LENGTH = 200

export type UserDto = { id: string; displayName: string; role: UserRole }
export type DeviceDto = { id: string; name: string; receiptPrefix: string }
/** syncMode (ruling R1): 'central' = the shift and its cash rows go to dayo (E2 shift lane) · 'local_only' = they never leave the tablet. */
export type ShiftDto = { id: string; businessDate: string; openedAt: string; openedBy: string; openingFloatSatang: number; syncMode: ShiftSyncMode }
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
  /** A device set up before block 2's dayo connect flow existed and is not linked to dayo yet — it links with an old owner PIN (ruling R7). */
  legacyDevice: boolean
  /** dayo.base_url is stored and the API key is in the secret store. */
  dayoLinked: boolean
  /** The stored `dayo.base_url`, or null when nothing is stored — not a secret. Controller ruling R1 (security):
   * the recovery and key-swap screens read this to lock their address field to the tablet's own central address. */
  dayoBaseUrl: string | null
  /** Active dayo staff with a known role who have no PIN on this tablet yet (spec 04 §6.5). */
  staffNeedingPin: StaffOptionDto[]
  /** ruling N2: "เชื่อมใหม่ด้วยคีย์ใหม่" is offered (no active owner with a PIN here, or the key was revoked). */
  ownerRecovery: boolean
  /** Task 14: the health of the link to dayo (spec 04 §4.3, §6.7, §10.5 · D80). */
  sync: SyncStatusDto
  /** D101 · R2: this device's shift after "นับเสร็จ" whose count is not confirmed yet — a reload goes back to the count review. */
  countingShift: { shiftId: string; countedAt: string } | null
  /** D68 · spec §6.8: counted shifts of this device with no Z yet (the red "ใบปิดกะ <วันที่> รอออนไลน์" bar), oldest count first. */
  zWaiting: WaitingZDto[]
}
/** Task 14 (spec 04 §4.3, §4.4 rule 9, §6.7, §10.5 · D80). Never carries the API key — only its masked form. */
export type SyncStatusDto = {
  linked: boolean
  apiState: ApiState | null
  maskedKey: string | null
  baseUrl: string | null
  /** Server clock minus tablet clock at the last E1/E2 answer (the last one measured — offline keeps it, spec §6.7). */
  clockSkewMs: number | null
  /** |skew| > 5 min, or CLOCK_AHEAD seen within the last hour (D80). */
  clockWarning: boolean
  pricingMismatch: boolean
  /** pricing.commit from E1; null = unknown, not a problem (spec §4.4 rule 9 — only the file hashes decide). */
  pricingCommit: string | null
  catalogVersion: number | null
  catalogCheckedAt: string | null
  catalogError: string | null
  lastPushAt: string | null
  pendingBills: number
  problemBills: number
  oldestPendingAt: string | null
  pendingOver24h: boolean
  /** Bills whose dayo computed_total differs from ours by any amount (spec §4.3). */
  priceDiffBills: number
  /** ruling N5: pending bills flagged CLOCK_AHEAD more than 24 h ahead of the server (owner-only banner). */
  clockFarAheadBills: number
}
export type StaffOptionDto = { id: string; displayName: string; role: UserRole }
export type DayoProbeInput = { baseUrl: string; apiKey: string }
export type DayoProbe = { clientName: string; lastReceiptNo: string | null; requiredPrefix: string | null; catalogVersion: number; owners: { id: string; displayName: string }[]; pricingMatches: boolean }
export type ConnectShopInput = { baseUrl: string; apiKey: string; receiptPrefix: string; ownerStaffId: string; ownerPin: string; promptPayId: string; legacyApproval: { userId: string; pin: string } | null }
export type SetStaffPinInput = { staffId: string; pin: string; approverUserId: string; approverPin: string }
export type ReplaceApiKeyInput = { baseUrl: string; apiKey: string; approverUserId: string; approverPin: string }
/** ruling N2 — no approver: the new key (issued on the dayo web after a LINE login) is the proof. */
export type RecoverOwnerInput = { baseUrl: string; apiKey: string; ownerStaffId: string; ownerPin: string }
export type OpenShiftInput = { userId: string; openingFloatSatang: number }
/** "เปิดกะด่วน" (spec §4.8): owner only, float 0 (Q3b-10 · D52). */
export type QuickOpenShiftInput = { userId: string }

/**
 * Products/sizes/sweetness/variants for AdjustScreen's "เป็นแก้ว (ตามสูตร)" picker (spec §5 · Q4-8) — active only
 * (M-11: a drink line can never name a product/variant `adjustStock` would refuse). No price or channel here: block 2
 * prices bills from dayo, but stock-out by drink still explodes the LOCAL recipe (recipe/BOM never moved to dayo).
 */
export type DrinkCatalogDto = {
  products: { id: string; code: string; nameTh: string }[]
  sizes: { id: string; name: string }[]
  sweetness: { id: string; name: string }[]
  variants: { id: string; productId: string; sizeId: string }[]
  defaultSizeId: string
  defaultSweetnessId: string
}

export type RecordSaleResult = {
  orderId: string
  receiptNo: string
  queueNo: number
  businessDate: string
  totalSatang: number
  changeSatang: number | null
  method: 'CASH' | 'PROMPTPAY'
}

/** The local payment method → dayo's payment code of the catalog (spec 04 §4.5 `payment`). */
export const PAYMENT_CODE = { CASH: 'cash', PROMPTPAY: 'qr' } as const

/** A sale priced with dayo's catalog (spec 04 §4.5, §5.1). The payment code comes from `payment.method` (PAYMENT_CODE). */
export type RecordSaleInput = {
  /** Created when the cart starts; resending the same id with the same lines returns the first result (plan 3 M12). */
  orderId: string
  actorUserId: string
  cart: Omit<CartDraft, 'paymentCode'>
  payment: { method: 'CASH'; tenderedSatang: number } | { method: 'PROMPTPAY' }
  /** The total the customer was shown — refused with PRICE_CHANGED when the price at the payment instant differs (D50 Q3-27). */
  expectedTotalSatang: number
}

/** One menu of the sell screen: the variants of one menuCode, sizes in catalog.sizes order (ADR-0054). */
export type SellMenuDto = {
  code: string
  nameTh: string
  /** categoryLabel, or the family when dayo sends none. */
  categoryLabel: string
  sortOrder: number
  isMatcha: boolean
  sizes: Size[]
  /** 0% → 100% per size. */
  sweetnessBySize: Partial<Record<Size, Sweetness[]>>
  defaultSize: Size
  defaultSweetness: Sweetness
}
export type SellCatalogDto = {
  catalogVersion: number
  /** The whole E1 catalog — the screen prices the cart with the same code recordSale uses (priceCart). */
  catalog: PosOrderCatalog
  /** Active sizes of the shop in sortOrder, with their labels. */
  sizes: { code: string; label: string }[]
  menus: SellMenuDto[]
  categories: string[]
  channels: { code: string; name: string }[]
  defaultChannelCode: string
  payments: { cash: boolean; qr: boolean }
  maxQtyPerLine: number
  /** Menu codes with the most cups in the last 7 business days (D48 Q3-9), at most 8. */
  bestSellerCodes: string[]
}

/**
 * How the central database has this bill (spec 04 §4.3, §12). `legacy` = a plan-3 bill (never sent) · `pending` = its
 * E2 row waits to send · `sent` = dayo answered accepted/duplicate · `problem` = the row is dead · `excluded` = an owner
 * closed it as outside dayo (ruling R8). `voidState` 'local_only' on a voided bill whose order WAS sent means dayo still
 * counts it as a sale (review item 23).
 */
export type CentralStateDto = {
  state: 'legacy' | 'pending' | 'sent' | 'problem' | 'excluded'
  orderNo: string | null
  computedTotalSatang: number | null
  /** What dayo computed minus what was charged here; null until dayo answered. */
  diffSatang: number | null
  duplicateOf: string[]
  /** dayo's reason of the last failed attempt (INVALID, UNKNOWN_CODE, …), or null. */
  reason: string | null
  voidState: 'none' | 'pending' | 'sent' | 'problem' | 'local_only'
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
  /** Who sold the bill (D61). */
  soldById: string
  soldByName: string
  central: CentralStateDto
  /** The owner's latest edit/cancel of this bill on the dayo web (E3 dayo_edit), display only (spec 04 §4.6 · O1 pending). */
  dayoEdit: DayoEditDto | null
}
/**
 * What dayo reported in E3 `dayo_edit`. Display only: the bill's total, payment and status here stay what was collected
 * (spec 04 §4.6). `editedByName` and `reason` are null for a key without staff:read; `version` may be null (contract).
 */
export type DayoEditDto = { kind: 'edit' | 'cancel' | string; editedAt: string; editedByName: string | null; reason: string | null; version: number | null }
export type OrderLineDto = {
  lineNo: number
  productName: string
  sizeName: string
  sweetnessName: string
  /** Block-2 lines only (null on a plan-3 bill). */
  milk: string | null
  grade: string | null
  qty: number
  unitPriceSatang: number
  lineTotalSatang: number
}
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
  /** The payment instant priced with dayo's catalog; null on a plan-3 bill (as are the next two). */
  soldAt: string | null
  channelCode: string | null
  catalogVersion: number | null
  /** Promotions dayo's pricing code applied at soldAt. */
  promotions: { name: string; discountSatang: number }[]
  lines: OrderLineDto[]
  events: OrderEventDto[]
  /** false also when dayo reports the bill cancelled on its web (dayoEdit.kind 'cancel' — it cannot be cancelled twice). */
  voidable: boolean
}

// ---- ก้อน 2 Task 15: ทางแก้ของ owner (หน้า "ส่งไม่ผ่าน") · บิลบอท/เว็บวันนี้ (E3) · ยอดไม่ตรงระบบกลาง ----

/** spec 04 §6.4: the owner's fixes of a row dayo refused (or of a far-ahead row, ruling N5 — EXCLUDE only). */
export type Remedy = 'RETRY' | 'RENUMBER' | 'REMAP_CODE' | 'REMAP_STAFF' | 'EXCLUDE'
/**
 * What dayo's UNKNOWN_CODE detail named (sync-problems.ts namedUnknown) — the one field "เลือกรหัสแทน" may change. For a
 * line: the lines of the bill dayo described, as they are now; `gradeOnly` = dayo named only their grade, so menu, size
 * and sweetness must stay as they are.
 */
export type RemapScope =
  | { field: 'channel' | 'payment' }
  | { field: 'line'; lines: { index: number; code: string; size: Size; sweetness: Sweetness }[]; gradeOnly: boolean }
/**
 * One row of the "ส่งไม่ผ่าน" page. `children` = rows waiting on it (PARENT_REJECTED) — they come back with it.
 * `remap` = set exactly when REMAP_CODE is offered. `remapHint` = why dayo's UNKNOWN_CODE has no remap here and what
 * to do instead (Thai), or null.
 */
export type SyncProblemDto = {
  outboxId: string; key: string; kind: 'order' | 'order_void'; orderId: string; receiptNo: string | null; at: string; reason: string; detail: string; remedies: Remedy[]
  remap: RemapScope | null; remapHint: string | null; children: SyncProblemDto[]
}
/** Every remedy = an owner's PIN + a reason (spec §6.4). */
export type OwnerApproval = { approverUserId: string; approverPin: string; reason: string }
export type RemapCodeInput = OwnerApproval & { outboxId: string; target: { field: 'line'; lineIndex: number; code: string; size: Size; sweetness: Sweetness } | { field: 'channel'; code: string } | { field: 'payment'; code: string } }
/** A bot / web bill of today from E3 (spec §4.6 — shown against double entry, Q44). */
export type CentralOrderDto = { orderNo: string; source: 'line' | 'web' | string; sourceLabel: string; createdByName: string | null; soldAt: string | null; totalSatang: number; payment: string | null; status: string; duplicateSuspect: boolean }
/**
 * spec §4.3 "ยอดไม่ตรงระบบกลาง" (owner, R11). 'amount' = dayo's computed_total differs by any satang. 'void_local_only'
 * (review item 23) = the bill reached dayo but its cancellation never will (EXCLUDE on the void row) — dayo still counts
 * it as a sale; block 3 handles the money.
 */
export type PriceDiffDto = { kind: 'amount' | 'void_local_only'; orderId: string; receiptNo: string; soldAt: string; totalSatang: number; computedTotalSatang: number | null; diffSatang: number | null; catalogVersion: number | null; amountMismatch: boolean }

/** Cancel a bill sold with dayo's catalog (spec 04 §4.5 order_void, §4.7) — same Thai day only, owner PIN. */
export type CancelSaleInput = {
  orderId: string
  /** Signed-in user who cancels; staff and managers only their own bills (Q44, ruling R11). */
  actorUserId: string
  /** Owner who approves with their PIN. */
  approverUserId: string
  approverPin: string
  reason: string
  /** "ทำเครื่องดื่มไปแล้วหรือยัง" — for the Z void list only; no stock row either way (ruling R6). */
  made: boolean
  /** Required when the bill was paid by PromptPay (D48 Q3-15). */
  refundReference: string | null
}

/** A paid-in / paid-out / drop typed in by a person (spec §3.5 · Q3b-9 · D52). VOID_REFUND is written by cancelSale only. */
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
export type ZReportDto = { id: string; shiftId: string; createdAt: string; hash: string; hashOk: boolean; snapshot: StoredZSnapshot | null }
/** Block-3 fields of a Z snapshot (D101 · spec 04 §4.10): absent from every Z frozen before block 3 (the hash covers the
 * stored JSON as it is — an old Z is never filled in). */
type Block3ZField = 'countedAt' | 'botWindow' | 'botBills'
type Block3CashField = 'drawerExpensesSatang' | 'botCashSatang'
/** A Z snapshot as read back from `z_report.snapshot_json`: a pre-block-3 Z has no countedAt/botWindow/botBills and its
 * `cash` has no drawerExpensesSatang/botCashSatang (carried from Task 2 review) — readers must treat them as optional. */
export type StoredZSnapshot = Omit<ZSnapshot, Block3ZField | 'cash'> & Partial<Pick<ZSnapshot, Block3ZField>> & {
  cash: Omit<CashInputs, Block3CashField> & Partial<Pick<CashInputs, Block3CashField>>
}

// ── block 3 count and Z (D101 · spec 04 §6.8 · §4.10) ────────────────────────────────────────────────────────────────
/** E4 as the tablet keeps it (spec §4.10): the bot/web cash bills of (after, until], until = the shift's counted_at. */
export type BotCashDto = { shiftId: string; after: string; until: string; bills: ZBotBill[]; cashTotalSatang: number; fetchedAt: string }
/** The count review screen: the shift's figures at counted_at, with the stored E4 bot cash when there is one (includesBotCash). */
/** zBlockedBy (ruling R7): the id of an earlier counted shift of this device still waiting for its Z — while set, a Z of
 * this shift is refused (Z_NOT_READY): the screen confirms the count only (z: null) and points at that shift first. */
export type CountSummaryDto = ShiftReportDto & { countedAt: string; syncMode: ShiftSyncMode; includesBotCash: boolean; bot: BotCashDto | null; zBlockedBy: string | null }
/** What the owner settles when the Z is issued: the reason (asked when |variance| ≥ the threshold, D102), the bank-app QR total, a chain acknowledgement. */
export type ZSettle = { varianceReason: string | null; bankQrTotalSatang: number | null; acknowledgeZChainBroken: boolean }
/** D101 step 2/3 · owner PIN · `z` null = count only (offline: no reason asked yet) · `z` set = count and Z in one transaction. */
export type ConfirmCountInput = { shiftId: string; actorUserId: string; approverUserId: string; approverPin: string; countLines: CashCountLine[]; shownFingerprint: string; z: ZSettle | null }
export type ConfirmCountResult = { countId: string; z: ZReportDto | null }
/** D101 step 3 (online again): the Z of a counted shift — owner PIN again. */
export type IssueZInput = ZSettle & { shiftId: string; approverUserId: string; approverPin: string; shownFingerprint: string }
/** A counted shift waiting for its Z · countedSatang = the saved cash_count (IssueZScreen shows the variance from it). */
export type WaitingZDto = { shiftId: string; businessDate: string; countedAt: string; syncMode: ShiftSyncMode; countedSatang: number }
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

// ---- แผน 4: สต็อก ----

export type PurchaseUnitDto = { id: string; name: string; qtyPerUnitMilli: number; isDefault: boolean }
export type BomLineDto = { itemId: string; code: string; name: string; useUnit: UseUnit; qtyMilli: number }
/** The latest production batch of a base — its expiry stands for the whole lump on hand (spec §4.6, no FIFO). */
export type BaseBatchDto = { batchId: string; createdAt: string; expiresAt: string | null; expiry: ExpiryState }
export type StockItemDto = {
  itemId: string
  code: string
  name: string
  kind: 'raw' | 'prepared'
  /** Controller ruling I-2 (Task 9 fix round 1): an item turned off in the catalog, but still on this list because it
   * still holds stock (M-11 · `stockCountableItems`). Receiving and producing must offer active items only — an
   * inactive item can still be counted or written off (Tasks 6/7), never bought or made. */
  isActive: boolean
  category: string
  useUnit: UseUnit
  onHandMilli: number
  avgCostUsat: number
  /** What a received price is compared with for PRICE_JUMP: the last purchase price, else the standard cost (Q4-15). */
  priceCheckUsat: number
  valueSatang: number
  reorderPointMilli: number
  status: StockStatus
  /** raw: low / out / negative · base: negative or expired (Q4-10) — what the sell-screen badge counts. */
  alert: boolean
  /** In the weekly "ชุดนับหลัก" (Q4-2 · D20). */
  isKeyCount: boolean
  units: PurchaseUnitDto[]
  shelfLifeHours: number | null
  /** Bases only. */
  latestBatch: BaseBatchDto | null
  /** Bases only: the current BOM (spec §3.3) — what the produce screen shows. */
  bom: { yieldMilli: number; lines: BomLineDto[] } | null
}
/** หน้าสต็อก (spec §5): tracked items only (D29), computed live, nothing written. */
export type StockOverviewDto = {
  generatedAt: string
  /** Where stock work typed now would land (Q4-1). */
  businessDate: string
  items: StockItemDto[]
  totalValueSatang: number
  alertCount: number
  /** Codes of bases whose latest batch is past its expiry with stock left (spec §4.6). */
  expiredBaseCodes: string[]
  /** closed_at of the last count that had at least one line, or null. */
  lastCountAt: string | null
  /** No count for COUNT_DUE_DAYS days, or never (Q4-12 · D20). */
  countDue: boolean
  openCountId: string | null
  /** No count with lines has closed yet: the next one is the opening count and must cover every item (Q4-13 · D30). */
  openingCountPending: boolean
}

/** One line of a receipt: `qtyUnitsMilli` of `purchaseUnitId` (null = the use unit) for `lineTotalSatang` (0 = free). */
export type PurchaseLineInput = { itemId: string; purchaseUnitId: string | null; qtyUnitsMilli: number; lineTotalSatang: number }
export type ReceivePurchaseInput = {
  actorUserId: string
  supplier: string
  note: string
  lines: PurchaseLineInput[]
  /** Q4-6: the total was paid with drawer cash — also write a PAID_OUT of the open shift. */
  paidFromDrawer: boolean
  /** true only after a PRICE_JUMP refusal, when the person checked the prices (D47 item 3). */
  acceptPriceJump: boolean
}
export type PurchaseDto = {
  id: string
  businessDate: string
  supplier: string | null
  totalSatang: number
  lines: { itemId: string; code: string; name: string; qtyUseMilli: number; lineTotalSatang: number; unitCostUsat: number }[]
  cashMovementId: string | null
  createdAt: string
}

/** ทำเบส (spec §5): `scaleBp` 10000 = one BOM batch; `yieldActualMilli` = what actually came out (default = standard). */
export type ProduceBatchInput = { actorUserId: string; itemId: string; scaleBp: number; yieldActualMilli: number }
export type ProductionBatchDto = {
  id: string
  itemId: string
  code: string
  name: string
  businessDate: string
  scaleBp: number
  yieldActualMilli: number
  unitCostUsat: number
  batchCostSatang: number
  expiresAt: string | null
  createdAt: string
  components: { itemId: string; code: string; qtyMilli: number }[]
}

/** A stock-out line typed by item: `qtyUnitsMilli` of `purchaseUnitId` (null = the use unit). */
export type AdjustItemInput = { itemId: string; purchaseUnitId: string | null; qtyUnitsMilli: number }
/** A stock-out by whole drinks through their current recipe (D50 Q3-20 แจก/ชดเชย, Q4-8). */
export type AdjustDrinkInput = { variantId: string; sweetnessId: string; qty: number }
export type AdjustStockInput = { actorUserId: string; reasonCode: AdjustReason; reason: string; items: AdjustItemInput[]; drinks: AdjustDrinkInput[] }
/** ทิ้งเบสที่เหลือทั้งหมด (spec §4.6): EXPIRED when its latest batch has expired, WASTE otherwise. */
export type DiscardBaseInput = { actorUserId: string; itemId: string }
export type StockAdjustmentDto = {
  id: string
  businessDate: string
  reasonCode: AdjustReason
  reason: string
  movements: { itemId: string; code: string; kind: MovementKind; qtyMilli: number }[]
  createdAt: string
}

/** A counted line of the open stock count (spec §3.3 stock_count_line) — `expectedUseMilli` frozen when it was counted (T4-2). */
export type StockCountLineDto = {
  itemId: string
  code: string
  name: string
  useUnit: UseUnit
  purchaseUnitId: string | null
  unitName: string
  countedUnitsMilli: number
  countedUseMilli: number
  expectedUseMilli: number
  varianceUseMilli: number
  varianceSatang: number
  /** No earlier closed count has this item: closing writes its opening balance, OPENING (D30 · Q4-13) — plan 7 leaves these lines out of the variance report. */
  opening: boolean
}
export type StockCountDto = {
  id: string
  businessDate: string
  status: 'open' | 'closed'
  createdBy: string
  createdAt: string
  closedAt: string | null
  lines: StockCountLineDto[]
  totalVarianceSatang: number
}
export type SaveCountLineInput = { actorUserId: string; countId: string; itemId: string; purchaseUnitId: string | null; countedUnitsMilli: number }
export type RemoveCountLineInput = { actorUserId: string; countId: string; itemId: string }
export type CloseStockCountInput = { actorUserId: string; countId: string }

/** Everything the UI may ask of the on-device database. Implemented in the Worker (and in Node tests). */
export interface PosApi {
  bootstrap(): Promise<BootstrapState>
  login(userId: string, pin: string): Promise<UserDto>
  openShift(input: OpenShiftInput): Promise<ShiftDto>
  loadDrinkCatalog(): Promise<DrinkCatalogDto>
  loadSellCatalog(): Promise<SellCatalogDto>
  recordSale(input: RecordSaleInput): Promise<RecordSaleResult>
  listOrders(): Promise<OrderSummaryDto[]>
  getOrder(orderId: string): Promise<OrderDetailDto>
  promptPayForAmount(amountSatang: number): Promise<string>
  cancelSale(input: CancelSaleInput): Promise<OrderDetailDto>
  quickOpenShift(input: QuickOpenShiftInput): Promise<ShiftDto>
  recordCashMovement(input: CashMovementInput): Promise<CashMovementDto>
  shiftReport(): Promise<ShiftReportDto>
  /** One-step close of a LOCAL-ONLY shift (block 2 behaviour = finishCount + confirmCount with the Z) · central → BOT_CASH_REQUIRED. */
  closeShift(input: CloseShiftInput): Promise<ZReportDto>
  /** "นับเสร็จ" (D101 step 1 · R3): the open shift takes no more bills or cash movements; counted_at is set once. */
  finishCount(input: { actorUserId: string }): Promise<{ shiftId: string; countedAt: string }>
  /** The count review of a counting/counted shift — the one rule confirmCount and issueZ use too (stored E4 when there is one). */
  countSummary(shiftId: string): Promise<CountSummaryDto>
  /** E4 (spec §4.10) — not in the serial queue · network failure = OFFLINE · 401/403/404 = DAYO_BAD_KEY/DAYO_KEY_NO_SCOPE/DAYO_API_DISABLED ·
   * > 500 bills = Z_TOO_LARGE · 5xx/429/timeout = DAYO_UNREACHABLE · an answer that fails the tablet's checks = DAYO_BAD_RESPONSE. */
  fetchBotCash(shiftId: string): Promise<BotCashDto>
  /** owner PIN · z != null: count + Z in one transaction (D101 step 2). */
  confirmCount(input: ConfirmCountInput): Promise<ConfirmCountResult>
  /** owner PIN again (D101 step 3) · Zs in count order (R7). */
  issueZ(input: IssueZInput): Promise<ZReportDto>
  listZReports(): Promise<ZReportSummaryDto[]>
  getZReport(shiftId: string): Promise<ZReportDto>
  exportBackup(actorUserId: string): Promise<BackupFileDto>
  confirmBackupSaved(input: ConfirmBackupInput): Promise<void>
  stockOverview(): Promise<StockOverviewDto>
  receivePurchase(input: ReceivePurchaseInput): Promise<PurchaseDto>
  produceBatch(input: ProduceBatchInput): Promise<ProductionBatchDto>
  adjustStock(input: AdjustStockInput): Promise<StockAdjustmentDto>
  discardBase(input: DiscardBaseInput): Promise<StockAdjustmentDto>
  startStockCount(actorUserId: string): Promise<StockCountDto>
  getOpenStockCount(): Promise<StockCountDto | null>
  saveCountLine(input: SaveCountLineInput): Promise<StockCountDto>
  removeCountLine(input: RemoveCountLineInput): Promise<StockCountDto>
  closeStockCount(input: CloseStockCountInput): Promise<StockCountDto>
  probeDayo(input: DayoProbeInput): Promise<DayoProbe>
  connectShop(input: ConnectShopInput): Promise<void>
  setStaffPin(input: SetStaffPinInput): Promise<UserDto>
  replaceApiKey(input: ReplaceApiKeyInput): Promise<void>
  recoverOwner(input: RecoverOwnerInput): Promise<void>
  /** "ส่งตอนนี้": one sync cycle now (E1 pull, then the push queue). Not in the serial queue — sales keep going. */
  syncNow(): Promise<SyncCycleResult>
  syncStatus(): Promise<SyncStatusDto>
  // Task 15 (spec 04 §4.3, §4.6, §6.4). Owner-only reads check the role here too, not only in the UI (review item 22).
  /** dead rows + far-ahead pending rows (N5), children under their parent · owner. */
  listSyncProblems(actorUserId: string): Promise<SyncProblemDto[]>
  retrySyncRow(input: OwnerApproval & { outboxId: string }): Promise<void>
  renumberReceipt(input: OwnerApproval & { outboxId: string }): Promise<{ oldReceiptNo: string; newReceiptNo: string }>
  remapCode(input: RemapCodeInput): Promise<void>
  remapStaff(input: OwnerApproval & { outboxId: string; newStaffId: string }): Promise<void>
  excludeFromSync(input: OwnerApproval & { outboxId: string }): Promise<void>
  /** owner · pretty JSON of {key, kind, data, lastError, createdAt} — no API key, no PIN, no sync_state. */
  exportSyncRow(input: { actorUserId: string; outboxId: string }): Promise<string>
  /** every role (Q44) · online only (E3) — OFFLINE otherwise · the network wait is outside the serial queue. */
  listCentralOrdersToday(): Promise<CentralOrderDto[]>
  /** every role · E3 with updated_since: records dayo_edit of this tablet's bills (display only) · OFFLINE when it cannot. */
  refreshDayoEdits(): Promise<{ updated: number }>
  /** owner (R11). */
  listPriceDiffs(actorUserId: string): Promise<PriceDiffDto[]>
}

/** Method names exposed through Comlink — must list every PosApi method (checked below). */
export const POS_API_METHODS = [
  'bootstrap',
  'login',
  'openShift',
  'loadDrinkCatalog',
  'loadSellCatalog',
  'recordSale',
  'listOrders',
  'getOrder',
  'promptPayForAmount',
  'cancelSale',
  'quickOpenShift',
  'recordCashMovement',
  'shiftReport',
  'closeShift',
  'finishCount',
  'countSummary',
  'fetchBotCash',
  'confirmCount',
  'issueZ',
  'listZReports',
  'getZReport',
  'exportBackup',
  'confirmBackupSaved',
  'stockOverview',
  'receivePurchase',
  'produceBatch',
  'adjustStock',
  'discardBase',
  'startStockCount',
  'getOpenStockCount',
  'saveCountLine',
  'removeCountLine',
  'closeStockCount',
  'probeDayo',
  'connectShop',
  'setStaffPin',
  'replaceApiKey',
  'recoverOwner',
  'syncNow',
  'syncStatus',
  'listSyncProblems',
  'retrySyncRow',
  'renumberReceipt',
  'remapCode',
  'remapStaff',
  'excludeFromSync',
  'exportSyncRow',
  'listCentralOrdersToday',
  'refreshDayoEdits',
  'listPriceDiffs',
] as const

type MissingMethods = Exclude<keyof PosApi, (typeof POS_API_METHODS)[number]>
export const POS_API_METHODS_COMPLETE: [MissingMethods] extends [never] ? true : MissingMethods = true
