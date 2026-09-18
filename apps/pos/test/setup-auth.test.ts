import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { requireOwnerPin } from '../src/api/auth'
import { LOCAL_DEVICE_KEY } from '../src/api/bootstrap'
import { pinLockMs } from '../src/api/pin-guard'
import { createPosApi } from '../src/api/pos-api'
import { getSetting } from '../src/api/setup'
import type { SetupInput } from '../src/api/types'
import { hashPin, verifyPin } from '../src/lib/pin'
import { openTestApi, TEST_PIN_COST } from './helpers/db'

const INPUT: SetupInput = {
  deviceName: 'แท็บเล็ตหน้าร้าน',
  receiptPrefix: 'A',
  owners: [
    { displayName: 'TungAo', pin: '1111' },
    { displayName: 'DCm', pin: '222222' },
  ],
  promptPayId: '081-234-5678',
}

describe('pin hashing', () => {
  it('verifies the right PIN only, with a random salt per hash', async () => {
    const a = await hashPin('1234', TEST_PIN_COST)
    const b = await hashPin('1234', TEST_PIN_COST)
    expect(a).toMatch(/^argon2id\$t=1,m=64,p=1\$[0-9a-f]{32}\$[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
    expect(await verifyPin('1234', a)).toBe(true)
    expect(await verifyPin('1235', a)).toBe(false)
    expect(await verifyPin('1234', 'garbage')).toBe(false)
  })
  it('rejects PINs that are not 4-6 digits', async () => {
    await expect(hashPin('12a4', TEST_PIN_COST)).rejects.toThrow(/^BAD_INPUT: /)
    await expect(hashPin('1234567', TEST_PIN_COST)).rejects.toThrow(/^BAD_INPUT: /)
  })
})

describe('setupShop', () => {
  it('registers this device, the owners, the PromptPay id and audit rows', async () => {
    const { api, db } = await openTestApi()
    await api.setupShop(INPUT)
    const boot = await api.bootstrap()
    expect(boot.needsSetup).toBe(false)
    expect(boot.device).toMatchObject({ name: 'แท็บเล็ตหน้าร้าน', receiptPrefix: 'A' })
    expect(boot.users.map((u) => [u.displayName, u.role])).toEqual([['TungAo', 'owner'], ['DCm', 'owner']])
    const local = await db.select().from(s.syncState).where(eq(s.syncState.key, LOCAL_DEVICE_KEY)).get()
    expect(local?.value).toBe(boot.device!.id)
    const setting = await db.select().from(s.setting).where(eq(s.setting.key, 'promptpay.id')).all()
    expect(setting).toHaveLength(1)
    expect(setting[0]).toMatchObject({ valueJson: '0812345678', effectiveFrom: '2026-09-17T03:00:00.000Z', version: 1 })
    expect(await db.select().from(s.device).get()).toMatchObject({ version: 1, updatedAt: '2026-09-17T03:00:00.000Z' })
    const audits = await db.select().from(s.auditLog).all()
    expect(audits.map((a) => [a.entity, a.action])).toEqual([['device', 'create'], ['user', 'create'], ['user', 'create'], ['setting', 'create']])
    expect(JSON.stringify(audits)).not.toContain('argon2id')
  })

  it('refuses a second setup and invalid input', async () => {
    const { api } = await openTestApi()
    await expect(api.setupShop({ ...INPUT, receiptPrefix: 'a1' })).rejects.toThrow(/^BAD_INPUT: /)
    await expect(api.setupShop({ ...INPUT, promptPayId: '12345' })).rejects.toThrow(/^BAD_INPUT: /)
    await expect(api.setupShop({ ...INPUT, owners: [] })).rejects.toThrow(/^BAD_INPUT: /)
    await expect(api.setupShop({ ...INPUT, owners: [INPUT.owners[0]!, INPUT.owners[0]!] })).rejects.toThrow(/^BAD_INPUT: /)
    expect((await api.bootstrap()).needsSetup).toBe(true)
    await api.setupShop(INPUT)
    await expect(api.setupShop(INPUT)).rejects.toThrow(/^ALREADY_SET_UP: /)
  })
})

describe('getSetting', () => {
  it('reads the latest value whose effective_from is not in the future (key + effective_from, D47 item 9)', async () => {
    const { api, db } = await openTestApi()
    await api.setupShop(INPUT)
    await db.insert(s.setting).values({ key: 'promptpay.id', valueJson: '0899999999', effectiveFrom: '2026-10-01T00:00:00.000Z', updatedAt: '2026-09-17T03:00:00.000Z', version: 1 })
    expect(await getSetting(db, 'promptpay.id', '2026-09-30T23:59:59.999Z')).toBe('0812345678')
    expect(await getSetting(db, 'promptpay.id', '2026-10-01T00:00:00.000Z')).toBe('0899999999')
    expect(await getSetting(db, 'no.such.key', '2026-10-01T00:00:00.000Z')).toBeNull()
  })
})

describe('login', () => {
  it('returns the user for the right PIN and PIN_WRONG otherwise', async () => {
    const { api } = await openTestApi()
    await api.setupShop(INPUT)
    const { users } = await api.bootstrap()
    const dcm = users.find((u) => u.displayName === 'DCm')!
    expect(await api.login(dcm.id, '222222')).toEqual(dcm)
    await expect(api.login(dcm.id, '1111')).rejects.toThrow(/^PIN_WRONG: /)
    await expect(api.login('no-such-user', '1111')).rejects.toThrow(/^PIN_WRONG: /)
  })
})

describe('PIN lockout (D50 Q3-21)', () => {
  async function ready() {
    const t = await openTestApi()
    await t.api.setupShop(INPUT)
    const { users } = await t.api.bootstrap()
    return { ...t, tung: users.find((u) => u.displayName === 'TungAo')!, dcm: users.find((u) => u.displayName === 'DCm')! }
  }

  it('schedule: 5 free tries, then 30 s doubling up to a 15 minute cap', () => {
    expect([0, 1, 4].map(pinLockMs)).toEqual([0, 0, 0])
    expect([5, 6, 7, 8, 9, 10, 11, 60].map(pinLockMs)).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 900_000, 900_000, 900_000])
  })

  it('locks after 5 wrong PINs in a row, refuses even the right PIN until the wait is over, then a success resets', async () => {
    const t = await ready()
    for (let i = 0; i < 4; i++) await expect(t.api.login(t.dcm.id, '0000')).rejects.toThrow(/^PIN_WRONG: /)
    await expect(t.api.login(t.dcm.id, '0000')).rejects.toThrow(/^PIN_LOCKED: 30$/)
    await expect(t.api.login(t.dcm.id, '222222')).rejects.toThrow(/^PIN_LOCKED: 30$/) // not even checked
    t.clock.advanceMs(29_001)
    await expect(t.api.login(t.dcm.id, '222222')).rejects.toThrow(/^PIN_LOCKED: 1$/) // seconds round up
    t.clock.advanceMs(999)
    expect(await t.api.login(t.dcm.id, '222222')).toEqual(t.dcm)
    for (let i = 0; i < 4; i++) await expect(t.api.login(t.dcm.id, '0000')).rejects.toThrow(/^PIN_WRONG: /) // counter was reset
  })

  it('each further failure after a lock doubles the wait, capped at 15 minutes', async () => {
    const t = await ready()
    for (let i = 0; i < 4; i++) await expect(t.api.login(t.dcm.id, '0000')).rejects.toThrow(/^PIN_WRONG: /)
    await expect(t.api.login(t.dcm.id, '0000')).rejects.toThrow(/^PIN_LOCKED: 30$/)
    let wait = 30
    for (const next of [60, 120, 240, 480, 900, 900]) {
      t.clock.advanceMs(wait * 1000)
      await expect(t.api.login(t.dcm.id, '0000')).rejects.toThrow(new RegExp(`^PIN_LOCKED: ${next}$`))
      wait = next
    }
  })

  it('the lock survives a reload and is per user', async () => {
    const t = await ready()
    for (let i = 0; i < 5; i++) await t.api.login(t.dcm.id, '0000').catch(() => undefined)
    const reloaded = createPosApi(t.db, t.deps) // a page reload builds a new api over the same database
    await expect(reloaded.login(t.dcm.id, '222222')).rejects.toThrow(/^PIN_LOCKED: 30$/)
    expect(await reloaded.login(t.tung.id, '1111')).toEqual(t.tung)
  })

  it('owner-PIN approval shares the counter, and every failure and lockout is audited without the PIN', async () => {
    const t = await ready()
    for (let i = 0; i < 4; i++) await expect(requireOwnerPin(t.db, t.deps, t.dcm.id, '9731')).rejects.toThrow(/^PIN_WRONG: /)
    await expect(t.api.login(t.dcm.id, '9731')).rejects.toThrow(/^PIN_LOCKED: 30$/)
    await expect(requireOwnerPin(t.db, t.deps, t.dcm.id, '222222')).rejects.toThrow(/^PIN_LOCKED: 30$/)
    const audits = await t.db.select().from(s.auditLog).where(eq(s.auditLog.entityId, t.dcm.id)).orderBy(s.auditLog.id).all()
    expect(audits.map((a) => a.action)).toEqual(['create', 'pin_fail', 'pin_fail', 'pin_fail', 'pin_fail', 'pin_fail', 'pin_lockout'])
    expect(audits.at(-1)).toMatchObject({ entity: 'user', actorUserId: null, afterJson: { fails: 5, lockSeconds: 30, lockedUntil: '2026-09-17T03:00:30.000Z' } })
    expect(JSON.stringify(audits)).not.toContain('9731')
  })
})
