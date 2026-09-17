import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { GENESIS_HASH, canonicalJson, computeEventHash, sha256Hex, verifyChain, type ChainedEvent, type EventCore } from '../src/hash.js'

describe('canonicalJson', () => {
  it('sorts keys recursively and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[1,{"y":2,"z":1}]},"b":1}')
  })
  it('is stable under key order', () => {
    expect(canonicalJson({ x: 1, y: 'a' })).toBe(canonicalJson({ y: 'a', x: 1 }))
  })
  it('rejects NaN, Infinity and bigint', () => {
    expect(() => canonicalJson({ n: NaN })).toThrow(TypeError)
    expect(() => canonicalJson({ n: Infinity })).toThrow(TypeError)
    expect(() => canonicalJson({ n: 1n })).toThrow(TypeError)
  })
  it('rejects non-plain objects (Date, Map, Set, class instances) instead of silently hashing them as {}', () => {
    class Foo { x = 1 }
    expect(() => canonicalJson({ at: new Date() })).toThrow(TypeError)
    expect(() => canonicalJson({ m: new Map([['a', 1]]) })).toThrow(TypeError)
    expect(() => canonicalJson({ s: new Set([1, 2]) })).toThrow(TypeError)
    expect(() => canonicalJson({ f: new Foo() })).toThrow(TypeError)
  })
  it('still accepts plain objects and objects with a null prototype', () => {
    expect(canonicalJson({ a: 1 })).toBe('{"a":1}')
    expect(canonicalJson(Object.create(null))).toBe('{}')
  })
})

describe('sha256Hex', () => {
  it('matches a known vector', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

function mkEvent(chainSeq: number, type = 'CREATED', payload: unknown = { n: chainSeq }): EventCore {
  return { chainId: 'dev-A', chainSeq, orderId: 'o1', seq: chainSeq, deviceId: 'dev-A', type, payload, actorType: 'user', actorId: 'u1', at: '2026-09-17T10:00:00.000Z' }
}
function chain(n: number): ChainedEvent[] {
  const out: ChainedEvent[] = []
  let prev = GENESIS_HASH
  for (let i = 1; i <= n; i++) {
    const e = mkEvent(i)
    const hash = computeEventHash(prev, e)
    out.push({ ...e, prevHash: prev, hash })
    prev = hash
  }
  return out
}

describe('event hash', () => {
  it('is pinned: sha256(prevHash + "\\n" + canonicalJson of the 10 EventCore fields) — changing the format breaks every stored chain', () => {
    // canonical body: {"actorId":"u1","actorType":"user","at":"2026-09-17T10:00:00.000Z","chainId":"dev-A","chainSeq":1,"deviceId":"dev-A","orderId":"o1","payload":{"n":1},"seq":1,"type":"CREATED"}
    expect(computeEventHash(GENESIS_HASH, mkEvent(1))).toBe('e95ff8d2936a30d967046ac82a6062b39ef3a477227f78b94250293d1f1171e0')
  })
  it('depends on prevHash and on every EventCore field, including orderId, seq, deviceId, chainId and chainSeq (D38)', () => {
    const e = mkEvent(1)
    const h = computeEventHash(GENESIS_HASH, e)
    expect(h).toHaveLength(64)
    expect(computeEventHash('1'.repeat(64), e)).not.toBe(h)
    const variants: EventCore[] = [
      { ...e, chainId: 'dev-B' },
      { ...e, chainSeq: 2 },
      { ...e, orderId: 'o2' },
      { ...e, seq: 2 },
      { ...e, deviceId: 'dev-B' },
      { ...e, deviceId: null },
      { ...e, type: 'PAID' },
      { ...e, payload: { n: 2 } },
      { ...e, actorType: 'system' },
      { ...e, actorId: 'u2' },
      { ...e, at: '2026-09-17T10:00:00.001Z' },
    ]
    for (const v of variants) expect(computeEventHash(GENESIS_HASH, v), JSON.stringify(v)).not.toBe(h)
  })
  it('hashes a server-written event (deviceId null)', () => {
    const e: EventCore = { chainId: 'server', chainSeq: 1, orderId: 'o9', seq: 1, deviceId: null, type: 'CREATED', payload: { lines: 2 }, actorType: 'customer', actorId: 'c1', at: '2026-09-17T10:00:00.000Z' }
    const h = computeEventHash(GENESIS_HASH, e)
    expect(h).toHaveLength(64)
    expect(verifyChain([{ ...e, prevHash: GENESIS_HASH, hash: h }])).toEqual({ ok: true })
  })
})

describe('event chain', () => {
  it('verifies a valid chain and an empty chain', () => {
    expect(verifyChain(chain(5))).toEqual({ ok: true })
    expect(verifyChain([])).toEqual({ ok: true })
  })
  it('detects tampering of any event payload', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 20 }), fc.nat(), (n, k) => {
      const c = chain(n)
      const idx = k % n
      const victim = c[idx]!
      c[idx] = { ...victim, payload: { n: -1 } }
      const r = verifyChain(c)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.brokenAtChainSeq).toBe(idx + 1)
    }))
  })
  it('detects an event moved to another order, renumbered within its order, or attributed to another device', () => {
    const tampered: Partial<EventCore>[] = [{ orderId: 'o2' }, { seq: 99 }, { deviceId: 'dev-B' }, { deviceId: null }]
    for (const patch of tampered) {
      const c = chain(3)
      c[1] = { ...c[1]!, ...patch }
      expect(verifyChain(c), JSON.stringify(patch)).toMatchObject({ ok: false, brokenAtChainSeq: 2, reason: 'hash mismatch' })
    }
  })
  it('detects a deleted event (gap in chainSeq) and a wrong genesis', () => {
    const c = chain(4)
    expect(verifyChain([c[0]!, c[1]!, c[3]!])).toMatchObject({ ok: false, brokenAtChainSeq: 4 })
    expect(verifyChain([{ ...c[0]!, prevHash: '1'.repeat(64) }])).toMatchObject({ ok: false, brokenAtChainSeq: 1 })
  })
  it('accepts events given out of order (sorts by chainSeq)', () => {
    const c = chain(3)
    expect(verifyChain([c[2]!, c[0]!, c[1]!])).toEqual({ ok: true })
  })
})
