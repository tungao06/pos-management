import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { GENESIS_HASH, verifyChain } from '@dayo/domain'
import { appendOrderEvents, loadDeviceChain, type EventContext } from '../src/db/events'
import { enqueueOutbox } from '../src/db/outbox'
import { openTestDb, sequentialIds } from './helpers/db'

const AT = '2026-09-17T03:00:00.000Z'

async function seedDeviceAndOrders(db: RemoteDb, orderIds: string[]): Promise<void> {
  // R rows carry version + updated_at (D47 item 8).
  await db.insert(s.device).values({ id: 'dev-1', name: 'แท็บเล็ต', receiptPrefix: 'A', isSellingDevice: true, registeredAt: AT, version: 1, updatedAt: AT })
  await db.insert(s.user).values({ id: 'u-1', displayName: 'TungAo', role: 'owner', pinHash: 'x', isActive: true, createdAt: AT, updatedAt: AT, version: 1 })
  const store = await db.select().from(s.channel).where(eq(s.channel.code, 'STORE')).get()
  for (const [i, id] of orderIds.entries()) {
    await db.insert(s.order).values({
      id, origin: 'device', deviceId: 'dev-1', receiptNo: `A-${String(i + 1).padStart(6, '0')}`, queueNo: i + 1, businessDate: '2026-09-17', shiftId: null,
      channelId: store!.id, customerId: null, status: 'paid', subtotalSatang: 0, discountSatang: 0, totalSatang: 0, vatSatang: 0,
      costSatang: 0, note: null, createdByType: 'user', createdById: 'u-1', createdAt: AT, paidAt: AT, readyAt: null, voidedAt: null,
    })
  }
}

function ctxFor(orderId: string, newId: () => string): EventContext {
  return { orderId, deviceId: 'dev-1', actorType: 'user', actorId: 'u-1', at: AT, newId }
}

describe('appendOrderEvents', () => {
  it('chains per device across orders, numbers seq per order, verifies, and queues every event', async () => {
    const { db } = await openTestDb()
    await seedDeviceAndOrders(db, ['o-1', 'o-2'])
    const newId = sequentialIds('ev')
    await db.transaction(async (tx) => {
      await appendOrderEvents(tx, ctxFor('o-1', newId), [{ type: 'CREATED', payload: { a: 1 } }, { type: 'PAID', payload: { receiptNo: 'A-000001' } }])
    })
    await db.transaction(async (tx) => {
      await appendOrderEvents(tx, ctxFor('o-2', newId), [{ type: 'CREATED', payload: {} }])
    })
    await db.transaction(async (tx) => {
      await appendOrderEvents(tx, ctxFor('o-1', newId), [{ type: 'VOIDED', payload: { reason: 'กดผิดเมนู', made: false, tenderedSatang: null } }])
    })
    const chain = await loadDeviceChain(db, 'dev-1')
    expect(chain.map((e) => [e.orderId, e.seq, e.chainSeq, e.type])).toEqual([
      ['o-1', 1, 1, 'CREATED'],
      ['o-1', 2, 2, 'PAID'],
      ['o-2', 1, 3, 'CREATED'],
      ['o-1', 3, 4, 'VOIDED'],
    ])
    expect(chain[0]!.prevHash).toBe(GENESIS_HASH)
    expect(verifyChain(chain)).toEqual({ ok: true })
    const outbox = await db.select().from(s.outbox).all()
    expect(outbox).toHaveLength(4)
    expect(outbox.every((r) => r.tableName === 'order_event' && r.idempotencyKey.startsWith('order_event:') && r.status === 'pending' && r.attempts === 0 && r.sentAt === null && r.deadAt === null)).toBe(true)
  })

  it('is append-only in the DB, and the chain still detects an edit made behind the triggers', async () => {
    const { db, raw } = await openTestDb()
    await seedDeviceAndOrders(db, ['o-1'])
    const newId = sequentialIds('ev')
    await db.transaction(async (tx) => {
      await appendOrderEvents(tx, ctxFor('o-1', newId), [{ type: 'CREATED', payload: { total: 4500 } }, { type: 'PAID', payload: { total: 4500 } }])
    })
    expect(() => raw.prepare('update order_event set payload_json = ? where chain_seq = 2').run('{"total":1}')).toThrow(/append-only/)
    // Someone editing the database file directly can drop the trigger — the hash chain is the second line of defence.
    raw.exec('DROP TRIGGER order_event_no_update')
    raw.prepare('update order_event set payload_json = ? where chain_seq = 2').run('{"total":1}')
    expect(verifyChain(await loadDeviceChain(db, 'dev-1'))).toMatchObject({ ok: false, brokenAtChainSeq: 2 })
  })

  it('rolls back with the surrounding transaction', async () => {
    const { db } = await openTestDb()
    await seedDeviceAndOrders(db, ['o-1'])
    const newId = sequentialIds('ev')
    await expect(
      db.transaction(async (tx) => {
        await appendOrderEvents(tx, ctxFor('o-1', newId), [{ type: 'CREATED', payload: {} }])
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await db.select().from(s.orderEvent).all()).toEqual([])
    expect(await db.select().from(s.outbox).all()).toEqual([])
  })
})

describe('enqueueOutbox', () => {
  it('keys rows as <table>:<id>[:suffix] and refuses the same key twice', async () => {
    const { db } = await openTestDb()
    const newId = sequentialIds('ob')
    await enqueueOutbox(db, 'order', { id: 'o-9', status: 'paid' }, AT, newId)
    await enqueueOutbox(db, 'order', { id: 'o-9', status: 'voided' }, AT, newId, 'voided')
    const rows = await db.select().from(s.outbox).all()
    expect(rows.map((r) => r.idempotencyKey)).toEqual(['order:o-9', 'order:o-9:voided'])
    expect(rows[1]!.rowJson).toEqual({ id: 'o-9', status: 'voided' })
    await expect(enqueueOutbox(db, 'order', { id: 'o-9' }, AT, newId)).rejects.toThrow()
  })
})
