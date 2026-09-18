import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

export const GENESIS_HASH = '0'.repeat(64)

function canon(v: unknown): unknown {
  if (v === null) return null
  switch (typeof v) {
    case 'string':
    case 'boolean':
      return v
    case 'number':
      if (!Number.isFinite(v)) throw new TypeError('canonicalJson: non-finite number')
      return v
    case 'bigint':
      throw new TypeError('canonicalJson: bigint not allowed')
    case 'undefined':
      return undefined
    case 'object': {
      if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : canon(x)))
      const proto = Object.getPrototypeOf(v)
      if (proto !== Object.prototype && proto !== null) {
        throw new TypeError(`canonicalJson: unsupported object type ${(v as object).constructor?.name ?? 'unknown'} (only plain objects and arrays are allowed)`)
      }
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(v as object).sort()) {
        const c = canon((v as Record<string, unknown>)[k])
        if (c !== undefined) out[k] = c
      }
      return out
    }
    default:
      throw new TypeError(`canonicalJson: unsupported type ${typeof v}`)
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canon(value))
}

export function sha256Hex(s: string): string {
  return bytesToHex(sha256(utf8ToBytes(s)))
}

/**
 * The hashed part of an `order_event` row (spec §4.9, D38). Every field here is a column of `order_event`
 * and every one of them is covered by the hash, so editing any of them in the database breaks the chain.
 *
 * - `chainId` — which hash chain the event belongs to: the selling device's id, or `'server'` (spec §3.4).
 * - `chainSeq` — 1, 2, 3, … within the chain; `verifyChain` requires it to be gap-free.
 * - `orderId` — the order the event is about.
 * - `seq` — 1, 2, 3, … within the order (unique per order in the database).
 * - `deviceId` — the device that wrote the event, or `null` when the server wrote it.
 */
export type EventCore = {
  chainId: string
  chainSeq: number
  orderId: string
  seq: number
  deviceId: string | null
  type: string
  payload: unknown
  actorType: 'user' | 'customer' | 'system'
  actorId: string
  at: string
}

export function computeEventHash(prevHash: string, e: EventCore): string {
  const body = canonicalJson({
    chainId: e.chainId,
    chainSeq: e.chainSeq,
    orderId: e.orderId,
    seq: e.seq,
    deviceId: e.deviceId,
    type: e.type,
    payload: e.payload,
    actorType: e.actorType,
    actorId: e.actorId,
    at: e.at,
  })
  return sha256Hex(`${prevHash}\n${body}`)
}

export type ChainedEvent = EventCore & { prevHash: string; hash: string }
export type ChainVerdict = { ok: true } | { ok: false; brokenAtChainSeq: number; reason: string }

export function verifyChain(events: readonly ChainedEvent[]): ChainVerdict {
  const sorted = [...events].sort((a, b) => a.chainSeq - b.chainSeq)
  let prev = GENESIS_HASH
  let expectedSeq = 1
  for (const e of sorted) {
    if (e.chainSeq !== expectedSeq) return { ok: false, brokenAtChainSeq: e.chainSeq, reason: `missing chainSeq ${expectedSeq}` }
    if (e.prevHash !== prev) return { ok: false, brokenAtChainSeq: e.chainSeq, reason: 'prevHash mismatch' }
    if (computeEventHash(prev, e) !== e.hash) return { ok: false, brokenAtChainSeq: e.chainSeq, reason: 'hash mismatch' }
    prev = e.hash
    expectedSeq += 1
  }
  return { ok: true }
}
