import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import type { CashMovementInput } from '../src/api/types'
import { openReadyApi, openTestApi, TEST_SETUP, type ReadyApi } from './helpers/db'

const input = (t: ReadyApi, patch: Partial<CashMovementInput> = {}): CashMovementInput => ({ actorUserId: t.owner.id, kind: 'PAID_OUT', amountSatang: 12_000, reason: 'ซื้อน้ำแข็ง', ...patch })

describe('recordCashMovement (spec §3.5 · Q3b-9 · D52)', () => {
  it('writes PAID_IN / PAID_OUT / DROP into the open shift with its outbox row', async () => {
    const t = await openReadyApi()
    const out = await t.api.recordCashMovement(input(t, { reason: '  ซื้อน้ำแข็ง  ' }))
    expect(out).toEqual({ id: expect.any(String), kind: 'PAID_OUT', amountSatang: 12_000, orderId: null, reason: 'ซื้อน้ำแข็ง', createdBy: t.owner.id, createdAt: '2026-09-17T03:00:00.000Z' })
    await t.api.recordCashMovement(input(t, { kind: 'PAID_IN', amountSatang: 50_000, reason: 'เติมเงินทอน' }))
    await t.api.recordCashMovement(input(t, { kind: 'DROP', amountSatang: 30_000, reason: 'เก็บเข้าตู้เซฟ' }))
    const rows = await t.db.select().from(s.cashMovement).all()
    expect(rows.map((r) => [r.kind, r.amountSatang, r.shiftId])).toEqual([
      ['PAID_OUT', 12_000, t.shift.id],
      ['PAID_IN', 50_000, t.shift.id],
      ['DROP', 30_000, t.shift.id],
    ])
    const keys = (await t.db.select().from(s.outbox).all()).map((r) => r.idempotencyKey)
    for (const r of rows) expect(keys).toContain(`cash_movement:${r.id}`)
    expect((await t.api.bootstrap()).pendingSyncItems).toBe(4) // the shift + 3 movements, one each (D50 Q3-26)
  })

  it('refuses VOID_REFUND, bad amounts, no or too long reason, unknown user, and no open shift — writing nothing', async () => {
    const t = await openReadyApi()
    const bad: Partial<CashMovementInput>[] = [
      { kind: 'VOID_REFUND' as CashMovementInput['kind'] },
      { amountSatang: 0 },
      { amountSatang: -100 },
      { amountSatang: 10.5 },
      { amountSatang: 10_000_001 },
      { reason: '   ' },
      { reason: 'ก'.repeat(201) },
      { actorUserId: 'nobody' },
    ]
    for (const patch of bad) await expect(t.api.recordCashMovement(input(t, patch))).rejects.toThrow(/^BAD_INPUT: /)
    expect(await t.db.select().from(s.cashMovement).all()).toEqual([])

    const u = await openTestApi()
    await u.api.setupShop(TEST_SETUP)
    const { users } = await u.api.bootstrap()
    await expect(u.api.recordCashMovement({ actorUserId: users[0]!.id, kind: 'PAID_IN', amountSatang: 100, reason: 'x' })).rejects.toThrow(/^NO_OPEN_SHIFT: /)
  })
})
