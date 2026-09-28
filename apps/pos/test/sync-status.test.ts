import { describe, expect, it } from 'vitest'
import { DAYO_KEYS, writeKey } from '../src/sync/state'
import { openConnectedApi } from './helpers/dayo'
import { openTestApi, sellCode } from './helpers/db'

describe('bootstrap().sync (spec 04 §4.3, §6.7, §10.5 · D80)', () => {
  it('is healthy right after setup', async () => {
    const t = await openConnectedApi()
    expect((await t.api.bootstrap()).sync).toMatchObject({ linked: true, apiState: 'ok', maskedKey: 'dayo_…cdef', clockWarning: false, pricingMismatch: false, catalogVersion: 42, pendingBills: 0, problemBills: 0, pendingOver24h: false, priceDiffBills: 0 })
  })
  it('warns when the server clock is 6 minutes ahead', async () => {
    const t = await openConnectedApi()
    t.mock.setNow('2026-09-25T03:06:00.000Z') // tablet clock stays at 03:00
    await t.api.syncNow()
    expect((await t.api.bootstrap()).sync).toMatchObject({ clockWarning: true })
  })
  it('flags a bill waiting more than 24 hours', async () => {
    const t = await openConnectedApi()
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.clock.advanceMs(25 * 3_600_000)
    expect((await t.api.bootstrap()).sync).toMatchObject({ pendingBills: 1, pendingOver24h: true })
  })
  it('counts a 1-satang difference from dayo (spec §4.3: every size is visible)', async () => {
    const t = await openConnectedApi()
    const r = await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.mock.override({ match: { receiptNo: r.receiptNo }, verdict: { status: 'accepted', data: { order_no: 'L260925-001', version: 1, computed_total: 45.01, amount_mismatch: false, duplicate_of: [], warnings: [] } }, times: 1 })
    await t.api.syncNow()
    expect((await t.api.bootstrap()).sync).toMatchObject({ priceDiffBills: 1 })
  })
  it('counts bills far ahead of the server clock for the owner-only banner (ruling N5)', async () => {
    const t = await openConnectedApi({ now: '2026-09-27T03:00:00.000Z' })
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    t.mock.setNow('2026-09-25T03:00:00.000Z')
    await t.api.syncNow()
    expect((await t.api.bootstrap()).sync).toMatchObject({ clockFarAheadBills: 1, pendingBills: 1, problemBills: 0 })
  })
  it('shows a revoked key', async () => {
    const t = await openConnectedApi()
    t.mock.setMode('unauthorized')
    await t.api.syncNow()
    expect((await t.api.bootstrap()).sync).toMatchObject({ apiState: 'unauthorized' })
  })
  it('shows the pricing commit dayo reported; null = unknown, not a problem (spec §4.4 rule 9)', async () => {
    const t = await openConnectedApi()
    await writeKey(t.db, DAYO_KEYS.pricingJson, JSON.stringify({ commit: 'a1b2c3d', files_sha256: {} }))
    expect((await t.api.bootstrap()).sync.pricingCommit).toBe('a1b2c3d')
    await writeKey(t.db, DAYO_KEYS.pricingJson, JSON.stringify({ commit: null, files_sha256: {} }))
    expect((await t.api.bootstrap()).sync.pricingCommit).toBeNull()
    await writeKey(t.db, DAYO_KEYS.pricingJson, '{not json')
    expect((await t.api.bootstrap()).sync.pricingCommit).toBeNull()
  })
  it('a tablet not set up yet reports an empty, unlinked status', async () => {
    const t = await openTestApi()
    expect((await t.api.bootstrap()).sync).toMatchObject({ linked: false, apiState: null, maskedKey: null, pendingBills: 0, clockWarning: false })
  })
  it('never shows a stored base URL the tablet would refuse (a restored backup) — not linked either (M3, fix round 1 item 6)', async () => {
    const t = await openConnectedApi()
    expect((await t.api.bootstrap()).sync).toMatchObject({ baseUrl: 'http://localhost:8787/api/v1', linked: true })
    await writeKey(t.db, DAYO_KEYS.baseUrl, 'http://evil.example/api/v1')
    expect((await t.api.bootstrap()).sync).toMatchObject({ baseUrl: null, linked: false })
  })
})
