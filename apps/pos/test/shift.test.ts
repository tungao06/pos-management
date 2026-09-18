import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { openTestApi, TEST_SETUP } from './helpers/db'

describe('openShift', () => {
  it('opens one shift on the Thai business date and queues it for sync', async () => {
    const { api, db, clock } = await openTestApi()
    await api.setupShop(TEST_SETUP)
    const { users } = await api.bootstrap()
    clock.set('2026-09-17T18:30:00.000Z') // 01:30 on 18 Sep in Bangkok
    const shift = await api.openShift({ userId: users[0]!.id, openingFloatSatang: 50_000 })
    expect(shift).toMatchObject({ businessDate: '2026-09-18', openingFloatSatang: 50_000, openedBy: users[0]!.id, openedAt: '2026-09-17T18:30:00.000Z' })
    const boot = await api.bootstrap()
    expect(boot.openShift).toEqual(shift)
    expect(boot.pendingSyncItems).toBe(1)
    expect((await db.select().from(s.outbox).all()).map((r) => r.idempotencyKey)).toEqual([`shift:${shift.id}`])
  })

  it('refuses a second open shift, a bad float and an unknown user', async () => {
    const { api } = await openTestApi()
    await api.setupShop(TEST_SETUP)
    const { users } = await api.bootstrap()
    const userId = users[0]!.id
    await expect(api.openShift({ userId, openingFloatSatang: -1 })).rejects.toThrow(/^BAD_INPUT: /)
    await expect(api.openShift({ userId, openingFloatSatang: 10.5 })).rejects.toThrow(/^BAD_INPUT: /)
    await expect(api.openShift({ userId: 'nobody', openingFloatSatang: 0 })).rejects.toThrow(/^BAD_INPUT: /)
    await api.openShift({ userId, openingFloatSatang: 0 })
    await expect(api.openShift({ userId, openingFloatSatang: 0 })).rejects.toThrow(/^SHIFT_ALREADY_OPEN: /)
  })

  it('needs the device to be set up', async () => {
    const { api } = await openTestApi()
    await expect(api.openShift({ userId: 'x', openingFloatSatang: 0 })).rejects.toThrow(/^NEEDS_SETUP: /)
  })

  it('the database itself refuses a second open shift on the same device (D47 item 6)', async () => {
    const { api, db } = await openTestApi()
    await api.setupShop(TEST_SETUP)
    const { users, device } = await api.bootstrap()
    const first = await api.openShift({ userId: users[0]!.id, openingFloatSatang: 0 })
    const second = { id: 'shift-2', deviceId: device!.id, businessDate: first.businessDate, status: 'open', openedBy: users[0]!.id, openedAt: first.openedAt, openingFloatSatang: 0, closedBy: null, closedAt: null } satisfies typeof s.shift.$inferInsert
    await expect(db.insert(s.shift).values(second)).rejects.toThrow()
  })
})
