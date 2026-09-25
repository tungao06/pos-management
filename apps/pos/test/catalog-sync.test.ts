import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { loadRichCatalog } from '@dayo/contracts/fixture-files'
import { createMockDayo, MOCK_API_KEY } from '@dayo/dayo-mock'
import vendor from '@dayo/dayo-pricing/VENDOR.json' with { type: 'json' }
import { pullCatalog, readCatalog, staffDisplayName } from '../src/sync/catalog'
import { DAYO_KEYS, readKey, writeKey } from '../src/sync/state'
import { openTestApi } from './helpers/db'

const PIN = 'argon2id$t=1,m=64,p=1$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000'

async function linked(mockNow = '2026-09-25T02:00:00.120Z') {
  // the test catalog's pricing hashes are dayo's at 65d3af2; the tablet vendors 135679c (Task 2 · shopSettings.ts and
  // types.ts differ) — serve the pinned VENDOR.json hashes so "same pricing" is the starting point of every test
  const mock = createMockDayo({ now: mockNow, catalog: { ...loadRichCatalog(), pricing: { commit: vendor.commit, files_sha256: { ...vendor.files } } } })
  const t = await openTestApi({ fetch: mock.fetch })
  await writeKey(t.db, DAYO_KEYS.baseUrl, 'https://mock/api/v1') // http only for localhost since Task 9 (security review item 1)
  await t.deps.secrets.setApiKey(MOCK_API_KEY)
  const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
  return { mock, t, ctx }
}

describe('pullCatalog (spec 04 §4.4, §6.5)', () => {
  it('stores the whole catalog in one row and remembers the version', async () => {
    const { ctx, t } = await linked()
    expect((await pullCatalog(ctx)).outcome).toBe('changed')
    const c = await readCatalog(t.db)
    expect(c?.catalogVersion).toBe(42)
    expect(c?.catalog.variants).toHaveLength(22)
    expect(c?.client?.name).toBe('แท็บเล็ตขาย 1')
  })
  it('asks with known_version and does not rewrite when unchanged', async () => {
    const { ctx, t } = await linked()
    await pullCatalog(ctx)
    const before = (await t.db.select().from(s.dayoCatalog).get())?.fetchedAt
    t.clock.advanceMs(60_000)
    expect((await pullCatalog(ctx)).outcome).toBe('unchanged')
    expect((await t.db.select().from(s.dayoCatalog).get())?.fetchedAt).toBe(before)
  })
  it('a new version replaces the copy', async () => {
    const { ctx, t, mock } = await linked()
    await pullCatalog(ctx)
    mock.bumpCatalog((c) => { c.catalog.variants[0]!.price = 40 })
    expect((await pullCatalog(ctx)).outcome).toBe('changed')
    expect((await readCatalog(t.db))?.catalog.variants[0]!.price).toBe(40)
  })
  it('measures the clock skew from server_time (D80)', async () => {
    const { ctx, t } = await linked('2026-09-25T03:10:00.000Z') // server 7 min ahead of the test clock (03:03)
    t.clock.set('2026-09-25T03:03:00.000Z')
    await pullCatalog(ctx)
    expect(Number(await readKey(t.db, DAYO_KEYS.clockSkewMs))).toBe(7 * 60_000)
  })
  it('flags a pricing version other than VENDOR.json (spec §4.4 rule 9)', async () => {
    const { ctx, t, mock } = await linked()
    await pullCatalog(ctx)
    expect(await readKey(t.db, DAYO_KEYS.pricingMismatch)).toBe('0')
    mock.bumpCatalog((c) => { c.pricing = { ...c.pricing, files_sha256: { ...c.pricing.files_sha256, 'packages/shared/src/money.ts': '0'.repeat(64) } } })
    await pullCatalog(ctx)
    expect(await readKey(t.db, DAYO_KEYS.pricingMismatch)).toBe('1')
  })
  it('pricing.commit null is kept as sent and only files_sha256 decides the mismatch (spec §4.4 rule 9)', async () => {
    const { ctx, t, mock } = await linked()
    mock.bumpCatalog((c) => { c.pricing = { ...c.pricing, commit: null } })
    expect((await pullCatalog(ctx)).outcome).toBe('changed')
    expect(await readKey(t.db, DAYO_KEYS.pricingMismatch)).toBe('0')
    expect(JSON.parse((await readKey(t.db, DAYO_KEYS.pricingJson))!).commit).toBeNull()
  })
  it('keeps the old catalog when the new one cannot be priced — but still applies staff, supported_* and pricing (ruling R12)', async () => {
    const { ctx, t, mock } = await linked()
    await pullCatalog(ctx)
    const at = t.clock.now()
    await t.db.insert(s.user).values([
      { id: '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f', displayName: 'TungAo', role: 'owner', pinHash: PIN, isActive: true, createdAt: at, updatedAt: at, version: 1 },
      { id: '1b2c3d4e-5f60-4172-8394-a5b6c7d8e9f0', displayName: 'Mint', role: 'staff', pinHash: PIN, isActive: true, createdAt: at, updatedAt: at, version: 1 },
    ])
    mock.bumpCatalog((c) => {
      (c.catalog.variants[0] as { size: string }).size = 'big'                                     // malformed size (not "<n> oz"): the schema refuses the catalog (ADR-0054 — '24 oz' would be a valid new size)
      c.staff = c.staff.map((x) => (x.display_name === 'Mint' ? { ...x, active: false } : x))   // …and Mint is removed the same day
      c.client = { ...c.client, name: 'แท็บเล็ตขาย 2' }
    })
    expect((await pullCatalog(ctx)).outcome).toBe('catalog_rejected')
    const kept = await readCatalog(t.db)
    expect(kept?.catalogVersion).toBe(42)
    expect(kept?.catalog.variants[0]!.size).toBe('16 oz')
    expect(kept?.staff.find((x) => x.display_name === 'Mint')?.active).toBe(false) // the staff copy follows dayo (not a stale cache)
    expect(kept?.client?.name).toBe('แท็บเล็ตขาย 2')
    expect(await readKey(t.db, DAYO_KEYS.catalogError)).toMatch(/CATALOG_UNREADABLE/)
    expect((await t.db.select().from(s.user).where(eq(s.user.id, '1b2c3d4e-5f60-4172-8394-a5b6c7d8e9f0')).get())?.isActive).toBe(false)
  })
  it('a catalog without sizes is refused the same way (ruling R12)', async () => {
    const { ctx, t, mock } = await linked()
    await pullCatalog(ctx)
    mock.bumpCatalog((c) => { delete (c.catalog as { sizes?: unknown }).sizes })
    expect((await pullCatalog(ctx)).outcome).toBe('catalog_rejected')
    expect((await readCatalog(t.db))?.catalog.sizes).toHaveLength(3)
  })
  it('a size the shop switches on (22 oz) is a normal new catalog, not a rejected one (ADR-0054)', async () => {
    const { ctx, t, mock } = await linked()
    await pullCatalog(ctx)
    mock.bumpCatalog((c) => {
      c.catalog.sizes[2]!.isActive = true
      c.catalog.variants.push({ ...structuredClone(c.catalog.variants[0]!), size: '22 oz', price: 55 })
    })
    expect((await pullCatalog(ctx)).outcome).toBe('changed')
    const c = await readCatalog(t.db)
    expect(c?.catalog.sizes).toHaveLength(3)
    expect(c?.catalog.sizes.find((x) => x.code === '22 oz')?.isActive).toBe(true)
    expect(c?.catalog.variants.filter((v) => v.size === '22 oz')).toHaveLength(1)
    expect(await readKey(t.db, DAYO_KEYS.catalogError)).toBeNull()
  })
  it('a null categoryLabel and an HH:MM:SS promotion time are stored exactly as sent', async () => {
    const { ctx, t, mock } = await linked()
    mock.bumpCatalog((c) => {
      c.catalog.variants[0]!.categoryLabel = null
      c.catalog.promotions[0]!.timeFrom = '17:00:00'
    })
    expect((await pullCatalog(ctx)).outcome).toBe('changed')
    const c = await readCatalog(t.db)
    expect(c?.catalog.variants[0]!.categoryLabel).toBeNull()
    expect(c?.catalog.promotions[0]!.timeFrom).toBe('17:00:00')
  })
  it('401 marks the key as revoked and no later pull calls dayo (spec §6.3)', async () => {
    const { ctx, t, mock } = await linked()
    mock.setMode('unauthorized')
    expect((await pullCatalog(ctx)).failure?.kind).toBe('unauthorized')
    expect(await readKey(t.db, DAYO_KEYS.apiState)).toBe('unauthorized')
    const calls = mock.requests().length
    expect((await pullCatalog(ctx)).outcome).toBe('blocked')
    expect(mock.requests().length).toBe(calls)
  })
  it('without a base URL or key the tablet is not linked and nothing is called', async () => {
    const mock = createMockDayo({ now: '2026-09-25T02:00:00.120Z' })
    const t = await openTestApi({ fetch: mock.fetch })
    const ctx = { db: t.db, deps: t.deps, serial: <T>(fn: () => Promise<T>) => fn() }
    expect((await pullCatalog(ctx)).outcome).toBe('not_linked')
    expect(mock.requests()).toHaveLength(0)
  })
  it('a stored base URL the client refuses is a failed pull, never a thrown error (Task 9 review note)', async () => {
    const { ctx, t, mock } = await linked()
    await writeKey(t.db, DAYO_KEYS.baseUrl, 'http://evil.example/api/v1') // plain http off localhost
    const r = await pullCatalog(ctx)
    expect(r.outcome).toBe('failed')
    expect(r.failure?.kind).toBe('network')
    expect(mock.requests()).toHaveLength(0)
  })
})

describe('staff from E1 (spec 04 §4.4 rule 5, §6.5, ruling R7/R10/R12)', () => {
  it('updates name/role/active of users that have a PIN, and disables users dayo does not list', async () => {
    const { ctx, t, mock } = await linked()
    const at = t.clock.now()
    await t.db.insert(s.user).values([
      { id: '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f', displayName: 'TungAo', role: 'owner', pinHash: PIN, isActive: true, createdAt: at, updatedAt: at, version: 1 },
      { id: '1b2c3d4e-5f60-4172-8394-a5b6c7d8e9f0', displayName: 'old name', role: 'staff', pinHash: PIN, isActive: true, createdAt: at, updatedAt: at, version: 1 },
      { id: 'legacy-owner', displayName: 'TungAo (plan 3)', role: 'owner', pinHash: PIN, isActive: true, createdAt: at, updatedAt: at, version: 1 },
    ])
    await pullCatalog(ctx)
    const rows = await t.db.select().from(s.user).all()
    expect(rows.find((u) => u.id.startsWith('1b2c'))).toMatchObject({ displayName: 'Mint', isActive: true })
    expect(rows.find((u) => u.id === 'legacy-owner')).toMatchObject({ isActive: false })
    mock.bumpCatalog((c) => { c.staff = c.staff.map((x) => (x.display_name === 'Mint' ? { ...x, active: false } : x)) })
    await pullCatalog(ctx)
    expect((await t.db.select().from(s.user).where(eq(s.user.id, '1b2c3d4e-5f60-4172-8394-a5b6c7d8e9f0')).get())?.isActive).toBe(false)
  })
  it('a role the tablet does not know keeps the user but locks them out (ruling R10)', async () => {
    const { ctx, t, mock } = await linked()
    const at = t.clock.now()
    await t.db.insert(s.user).values({ id: '1b2c3d4e-5f60-4172-8394-a5b6c7d8e9f0', displayName: 'Mint', role: 'staff', pinHash: PIN, isActive: true, createdAt: at, updatedAt: at, version: 1 })
    mock.bumpCatalog((c) => { c.staff = c.staff.map((x) => (x.display_name === 'Mint' ? { ...x, role: 'barista' } : x)) })
    await pullCatalog(ctx)
    expect(await t.db.select().from(s.user).where(eq(s.user.id, '1b2c3d4e-5f60-4172-8394-a5b6c7d8e9f0')).get()).toMatchObject({ role: 'staff', isActive: false })
  })
  it('a staff list without any active owner is not applied (review item 9)', async () => {
    const { ctx, t, mock } = await linked()
    const at = t.clock.now()
    await t.db.insert(s.user).values({ id: '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f', displayName: 'TungAo', role: 'owner', pinHash: PIN, isActive: true, createdAt: at, updatedAt: at, version: 1 })
    mock.bumpCatalog((c) => { c.staff = [] })
    await pullCatalog(ctx)
    expect((await t.db.select().from(s.user).where(eq(s.user.id, '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f')).get())?.isActive).toBe(true)
    expect(await readKey(t.db, DAYO_KEYS.catalogError)).toMatch(/NO_ACTIVE_OWNER/)
  })
  it.each([['deactivated', { active: false }], ['demoted', { role: 'staff' }]] as const)('the last owner with a PIN who is %s in dayo loses owner rights here at once (ruling N2)', async (_, change) => {
    const { ctx, t, mock } = await linked()
    const at = t.clock.now()
    await t.db.insert(s.user).values({ id: '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f', displayName: 'TungAo', role: 'owner', pinHash: PIN, isActive: true, createdAt: at, updatedAt: at, version: 1 })
    mock.bumpCatalog((c) => { c.staff = c.staff.map((x) => (x.display_name === 'TungAo' ? { ...x, ...change } : x)) }) // DCm stays an active owner in dayo (no PIN here)
    await pullCatalog(ctx)
    const u = await t.db.select().from(s.user).where(eq(s.user.id, '7d0c2f6e-3b1a-4c55-9a0e-1f2b3c4d5e6f')).get()
    expect(u!.isActive && u!.role === 'owner').toBe(false)
  })
  it('an empty display name shows as "พนักงาน" + the last 4 of the id', () => {
    expect(staffDisplayName({ id: '4e5f6071-8293-44a5-b6c7-d8e9f0a1b2c3', display_name: '', role: 'staff', active: true })).toBe('พนักงาน b2c3')
  })
})
