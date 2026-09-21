import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { REASON_MAX_LENGTH } from '../src/api/types'
import { openReadyApi, PINS, sellSku } from './helpers/db'

// Plan 3 Task 13 M-4 (carried to plan 3b): a reason is at most 200 characters — void and discount share the cap.
describe('reason length cap', () => {
  it('is 200 characters', () => {
    expect(REASON_MAX_LENGTH).toBe(200)
  })

  it('a void reason of 201 characters is BAD_INPUT and writes nothing; 200 is accepted', async () => {
    const t = await openReadyApi()
    const sale = await sellSku(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 4500 })
    const input = { orderId: sale.orderId, actorUserId: t.owner.id, approverUserId: t.other.id, approverPin: PINS.DCm, made: false, refundReference: null }
    await expect(t.api.voidOrder({ ...input, reason: 'ก'.repeat(201) })).rejects.toThrow(/^BAD_INPUT: /)
    expect(await t.db.select().from(s.cashMovement).all()).toEqual([])
    const detail = await t.api.voidOrder({ ...input, reason: `  ${'ก'.repeat(200)}  ` }) // trimmed before counting
    expect(detail.status).toBe('voided')
  })

  it('a discount reason of 201 characters is BAD_INPUT and writes no order', async () => {
    const t = await openReadyApi()
    await expect(sellSku(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 4500 }, { amountSatang: 500, reason: 'x'.repeat(201) })).rejects.toThrow(/^BAD_INPUT: /)
    expect(await t.db.select().from(s.order).all()).toEqual([])
    const ok = await sellSku(t, 'Original-16oz', 1, { method: 'CASH', tenderedSatang: 4500 }, { amountSatang: 500, reason: 'x'.repeat(200) })
    expect(ok.totalSatang).toBe(4000)
  })
})
