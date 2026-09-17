import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { GENESIS_HASH, canonicalJson, computeEventHash, sha256Hex, verifyChain, type EventCore } from '../src/hash.js'

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
})

describe('sha256Hex', () => {
  it('matches a known vector', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

function mkEvent(chainSeq: number, type = 'CREATED', payload: unknown = { n: chainSeq }): EventCore {
  return { chainId: 'dev-A', chainSeq, orderId: 'o1', type, payload, actorType: 'user', actorId: 'u1', at: '2026-09-17T10:00:00.000Z' }
}
function chain(n: number) {
  const out: (EventCore & { prevHash: string; hash: string })[] = []
  let prev = GENESIS_HASH
  for (let i = 1; i <= n; i++) {
    const e = mkEvent(i)
    const hash = computeEventHash(prev, e)
    out.push({ ...e, prevHash: prev, hash })
    prev = hash
  }
  return out
}

describe('event chain', () => {
  it('hash depends on prevHash and every field', () => {
    const e = mkEvent(1)
    const h = computeEventHash(GENESIS_HASH, e)
    expect(h).toHaveLength(64)
    expect(computeEventHash('1'.repeat(64), e)).not.toBe(h)
    expect(computeEventHash(GENESIS_HASH, { ...e, type: 'PAID' })).not.toBe(h)
    expect(computeEventHash(GENESIS_HASH, { ...e, payload: { n: 2 } })).not.toBe(h)
  })
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
