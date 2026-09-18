import type { UserRole } from '@dayo/contracts'

export const PIN_RE = /^\d{4,6}$/

export type UserDto = { id: string; displayName: string; role: UserRole }
export type DeviceDto = { id: string; name: string; receiptPrefix: string }
export type ShiftDto = { id: string; businessDate: string; openedAt: string; openedBy: string; openingFloatSatang: number }
export type BootstrapState = { needsSetup: boolean; device: DeviceDto | null; users: UserDto[]; openShift: ShiftDto | null; pendingSyncItems: number }
export type SetupInput = { deviceName: string; receiptPrefix: string; owners: { displayName: string; pin: string }[]; promptPayId: string }
export type OpenShiftInput = { userId: string; openingFloatSatang: number }

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

/** Everything the UI may ask of the on-device database. Implemented in the Worker (and in Node tests). */
export interface PosApi {
  bootstrap(): Promise<BootstrapState>
  setupShop(input: SetupInput): Promise<void>
  login(userId: string, pin: string): Promise<UserDto>
  openShift(input: OpenShiftInput): Promise<ShiftDto>
  loadMenu(): Promise<MenuDto>
}

/** Method names exposed through Comlink — must list every PosApi method (checked below). */
export const POS_API_METHODS = ['bootstrap', 'setupShop', 'login', 'openShift', 'loadMenu'] as const

type MissingMethods = Exclude<keyof PosApi, (typeof POS_API_METHODS)[number]>
export const POS_API_METHODS_COMPLETE: [MissingMethods] extends [never] ? true : MissingMethods = true
