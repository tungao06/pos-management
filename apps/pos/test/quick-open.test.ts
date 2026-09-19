import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { wasQuickOpened } from '../src/api/shift'
import { hashPin } from '../src/lib/pin'
import { openTestApi, TEST_PIN_COST, TEST_SETUP } from './helpers/db'

describe('quickOpenShift (spec §4.8 "เปิดกะด่วน" · plan 3 M18 · Q3b-10 · D52)', () => {
  it('an owner opens with a 0 float; a quick_open audit row is written in the same transaction; the shift syncs like any other', async () => {
    const t = await openTestApi()
    await t.api.setupShop(TEST_SETUP)
    const { users } = await t.api.bootstrap()
    const owner = users[0]!
    const shift = await t.api.quickOpenShift({ userId: owner.id })
    expect(shift).toMatchObject({ openingFloatSatang: 0, openedBy: owner.id, businessDate: '2026-09-17' })
    expect((await t.api.bootstrap()).openShift).toEqual(shift)
    const audit = (await t.db.select().from(s.auditLog).all()).filter((a) => a.action === 'quick_open')
    expect(audit).toEqual([
      { id: expect.any(String), entity: 'shift', entityId: shift.id, action: 'quick_open', beforeJson: null, afterJson: { openingFloatSatang: 0, openedBy: owner.id }, actorUserId: owner.id, at: shift.openedAt },
    ])
    expect((await t.db.select().from(s.outbox).all()).map((r) => r.idempotencyKey)).toEqual([`shift:${shift.id}`])
    expect(await wasQuickOpened(t.db, shift.id)).toBe(true)
  })

  it('a staff user gets NOT_OWNER and nothing is written; a second open shift is refused', async () => {
    const t = await openTestApi()
    await t.api.setupShop(TEST_SETUP)
    t.raw
      .prepare('insert into "user" (id, display_name, role, pin_hash, is_active, created_at, updated_at, version) values (?, ?, ?, ?, 1, ?, ?, 1)')
      .run('staff-1', 'พนักงาน', 'staff', await hashPin('3333', TEST_PIN_COST), t.clock.now(), t.clock.now())
    await expect(t.api.quickOpenShift({ userId: 'staff-1' })).rejects.toThrow(/^NOT_OWNER: /)
    await expect(t.api.quickOpenShift({ userId: 'nobody' })).rejects.toThrow(/^BAD_INPUT: /)
    expect(await t.db.select().from(s.shift).all()).toEqual([])
    const { users } = await t.api.bootstrap()
    const shift = await t.api.openShift({ userId: users[0]!.id, openingFloatSatang: 50_000 })
    await expect(t.api.quickOpenShift({ userId: users[0]!.id })).rejects.toThrow(/^SHIFT_ALREADY_OPEN: /)
    expect((await t.db.select().from(s.auditLog).all()).filter((a) => a.action === 'quick_open')).toEqual([])
    expect(await wasQuickOpened(t.db, shift.id)).toBe(false)
  })
})
