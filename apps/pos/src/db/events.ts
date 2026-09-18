import { asc, desc, eq } from 'drizzle-orm'
import type { EventType } from '@dayo/contracts'
import type { RemoteDb } from '@dayo/db-schema/browser'
import * as s from '@dayo/db-schema/sqlite'
import { computeEventHash, GENESIS_HASH, type ChainedEvent } from '@dayo/domain'
import { enqueueOutbox } from './outbox'

export type NewEvent = { type: EventType; payload: Record<string, unknown> }
export type EventContext = { orderId: string; deviceId: string; actorType: 'user' | 'system'; actorId: string; at: string; newId: () => string }

/**
 * Appends events for one order to this device's hash chain (spec §4.9, D38): chain_id = device id,
 * chain_seq continues the device chain, seq continues the order. Must run inside the caller's transaction.
 */
export async function appendOrderEvents(db: RemoteDb, ctx: EventContext, events: readonly NewEvent[]): Promise<string[]> {
  const lastInChain = await db
    .select({ chainSeq: s.orderEvent.chainSeq, hash: s.orderEvent.hash })
    .from(s.orderEvent)
    .where(eq(s.orderEvent.chainId, ctx.deviceId))
    .orderBy(desc(s.orderEvent.chainSeq))
    .limit(1)
    .get()
  const lastInOrder = await db.select({ seq: s.orderEvent.seq }).from(s.orderEvent).where(eq(s.orderEvent.orderId, ctx.orderId)).orderBy(desc(s.orderEvent.seq)).limit(1).get()

  let chainSeq = lastInChain?.chainSeq ?? 0
  let prevHash = lastInChain?.hash ?? GENESIS_HASH
  let seq = lastInOrder?.seq ?? 0
  const ids: string[] = []
  for (const e of events) {
    chainSeq += 1
    seq += 1
    const hash = computeEventHash(prevHash, {
      chainId: ctx.deviceId,
      chainSeq,
      orderId: ctx.orderId,
      seq,
      deviceId: ctx.deviceId,
      type: e.type,
      payload: e.payload,
      actorType: ctx.actorType,
      actorId: ctx.actorId,
      at: ctx.at,
    })
    const row = {
      id: ctx.newId(),
      orderId: ctx.orderId,
      seq,
      chainId: ctx.deviceId,
      chainSeq,
      type: e.type,
      payloadJson: e.payload,
      actorType: ctx.actorType,
      actorId: ctx.actorId,
      deviceId: ctx.deviceId,
      at: ctx.at,
      prevHash,
      hash,
    } satisfies typeof s.orderEvent.$inferInsert
    await db.insert(s.orderEvent).values(row)
    await enqueueOutbox(db, 'order_event', row, ctx.at, ctx.newId)
    ids.push(row.id)
    prevHash = hash
  }
  return ids
}

export function toChainedEvent(row: typeof s.orderEvent.$inferSelect): ChainedEvent {
  return {
    chainId: row.chainId,
    chainSeq: row.chainSeq,
    orderId: row.orderId,
    seq: row.seq,
    deviceId: row.deviceId, // null only for server-written events (EventCore.deviceId: string | null)
    type: row.type,
    payload: row.payloadJson,
    actorType: row.actorType, // typed enum column (plan 2 textEnum) — no cast
    actorId: row.actorId,
    at: row.at,
    prevHash: row.prevHash,
    hash: row.hash,
  }
}

export async function loadDeviceChain(db: RemoteDb, deviceId: string): Promise<ChainedEvent[]> {
  const rows = await db.select().from(s.orderEvent).where(eq(s.orderEvent.chainId, deviceId)).orderBy(asc(s.orderEvent.chainSeq)).all()
  return rows.map(toChainedEvent)
}
