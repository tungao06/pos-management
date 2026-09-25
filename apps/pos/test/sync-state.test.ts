import { describe, expect, it } from 'vitest'
import { BACKOFF_MS, DAYO_KEYS, backoffMs, decodeLastError, deleteKey, encodeLastError, readKey, recordServerTime, skewMs, writeKey } from '../src/sync/state'
import { openTestDb } from './helpers/db'

describe('backoffMs (spec §6.3: 5 s → 15 s → 1 min → 5 min → 15 min, ±20 %)', () => {
  it.each([[1, 5_000], [2, 15_000], [3, 60_000], [4, 300_000], [5, 900_000], [6, 900_000], [50, 900_000]])('attempt %i centres on %i ms', (attempt, base) => {
    expect(backoffMs(attempt, () => 0.5)).toBe(base)
  })
  it('clamps attempts below 1 to the first step', () => {
    expect(backoffMs(0, () => 0.5)).toBe(5_000)
    expect(backoffMs(-3, () => 0.5)).toBe(5_000)
  })
  it('jitter stays within ±20 %', () => {
    for (const base of BACKOFF_MS) {
      const attempt = BACKOFF_MS.indexOf(base) + 1
      expect(backoffMs(attempt, () => 0)).toBe(Math.round(base * 0.8))
      expect(backoffMs(attempt, () => 0.999999)).toBeLessThanOrEqual(Math.round(base * 1.2))
      expect(backoffMs(attempt, () => 0.999999)).toBeGreaterThan(Math.round(base * 1.19))
    }
  })
})

describe('skewMs (server minus device, at the request midpoint)', () => {
  it('server ahead is positive, behind is negative, both Z and +00:00 parse', () => {
    const sent = Date.parse('2026-09-25T02:00:00.000Z')
    expect(skewMs('2026-09-25T02:00:00.600Z', sent, sent + 200)).toBe(500)
    expect(skewMs('2026-09-25T01:59:59.900+00:00', sent, sent + 200)).toBe(-200)
    expect(skewMs('2026-09-25T02:10:00.100+00:00', sent, sent + 200)).toBe(600_000)
  })
})

describe('encode/decodeLastError', () => {
  it('round-trips reason, detail and the extras', () => {
    const raw = encodeLastError('UNSUPPORTED', 'field x', { supportedHash: 'abc', farAhead: true })
    expect(decodeLastError(raw)).toEqual({ reason: 'UNSUPPORTED', detail: 'field x', supportedHash: 'abc', farAhead: true })
    expect(decodeLastError(encodeLastError('BUSY', ''))).toEqual({ reason: 'BUSY', detail: '' })
  })
  it('clips by code points so Thai text and emoji stay whole JSON', () => {
    const raw = encodeLastError('R'.repeat(100), 'ก'.repeat(600) + '😀')
    const d = decodeLastError(raw)
    expect([...d.reason]).toHaveLength(60)
    expect([...d.detail]).toHaveLength(500)
    expect(() => JSON.parse(raw)).not.toThrow()
  })
  it('garbage never throws', () => {
    expect(decodeLastError(null)).toEqual({ reason: '', detail: '' })
    expect(decodeLastError('not json')).toEqual({ reason: '', detail: 'not json' })
    expect(decodeLastError('{"reason":5,"detail":["x"],"supportedHash":1,"farAhead":"yes"}')).toEqual({ reason: '', detail: '' })
    expect(decodeLastError('null')).toEqual({ reason: '', detail: 'null' })
    expect(decodeLastError('42')).toEqual({ reason: '', detail: '42' })
    expect(decodeLastError('[1]')).toEqual({ reason: '', detail: '[1]' })
  })
})

describe('sync_state keys', () => {
  it('all live under dayo.* and none is the API key', () => {
    for (const v of Object.values(DAYO_KEYS)) expect(v).toMatch(/^dayo\.[a-z_]+$/)
    expect(Object.values(DAYO_KEYS)).not.toContain('dayo.api_key')
  })
  it('read, write (upsert) and delete', async () => {
    const { db } = await openTestDb()
    expect(await readKey(db, DAYO_KEYS.lastPushAt)).toBeNull()
    await writeKey(db, DAYO_KEYS.lastPushAt, 'a')
    await writeKey(db, DAYO_KEYS.lastPushAt, 'b')
    expect(await readKey(db, DAYO_KEYS.lastPushAt)).toBe('b')
    await deleteKey(db, DAYO_KEYS.lastPushAt)
    expect(await readKey(db, DAYO_KEYS.lastPushAt)).toBeNull()
    await deleteKey(db, DAYO_KEYS.lastPushAt) // deleting a missing key is fine
  })
  it('recordServerTime stores the skew and when it was measured', async () => {
    const { db } = await openTestDb()
    const sent = Date.parse('2026-09-25T02:00:00.000Z')
    await recordServerTime(db, '2026-09-25T02:00:00.600+00:00', sent, sent + 200, '2026-09-25T02:00:00.200Z')
    expect(await readKey(db, DAYO_KEYS.clockSkewMs)).toBe('500')
    expect(await readKey(db, DAYO_KEYS.clockMeasuredAt)).toBe('2026-09-25T02:00:00.200Z')
  })
})
