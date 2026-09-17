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

export type EventCore = {
  chainId: string
  chainSeq: number
  orderId: string
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
