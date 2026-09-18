import type { UserRole } from '@dayo/contracts'

export const PIN_RE = /^\d{4,6}$/

export type UserDto = { id: string; displayName: string; role: UserRole }
export type DeviceDto = { id: string; name: string; receiptPrefix: string }
export type ShiftDto = { id: string; businessDate: string; openedAt: string; openedBy: string; openingFloatSatang: number }
export type BootstrapState = { needsSetup: boolean; device: DeviceDto | null; users: UserDto[]; openShift: ShiftDto | null; pendingSyncItems: number }
export type SetupInput = { deviceName: string; receiptPrefix: string; owners: { displayName: string; pin: string }[]; promptPayId: string }

/** Everything the UI may ask of the on-device database. Implemented in the Worker (and in Node tests). */
export interface PosApi {
  bootstrap(): Promise<BootstrapState>
  setupShop(input: SetupInput): Promise<void>
  login(userId: string, pin: string): Promise<UserDto>
}

/** Method names exposed through Comlink — must list every PosApi method (checked below). */
export const POS_API_METHODS = ['bootstrap', 'setupShop', 'login'] as const

type MissingMethods = Exclude<keyof PosApi, (typeof POS_API_METHODS)[number]>
export const POS_API_METHODS_COMPLETE: [MissingMethods] extends [never] ? true : MissingMethods = true
