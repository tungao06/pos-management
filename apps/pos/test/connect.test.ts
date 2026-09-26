import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { createMockDayo, MOCK_API_KEY } from '@dayo/dayo-mock'
import { posErrorCode } from '../src/api/errors'
import { pullCatalog } from '../src/sync/catalog'
import { DAYO_KEYS, deleteKey, readKey, writeKey } from '../src/sync/state'
import { openTestApi, vacuumInto } from './helpers/db'
import { STAFF } from './helpers/dayo'

const INPUT = { baseUrl: 'http://localhost:8787/api/v1/', apiKey: MOCK_API_KEY, receiptPrefix: 'A', ownerStaffId: STAFF.TungAo, ownerPin: '1111', promptPayId: '0812345678', legacyApproval: null }
async function fresh() { const mock = createMockDayo({ now: '2026-09-25T02:00:00.120Z' }); return { mock, t: await openTestApi({ fetch: mock.fetch }) } }
async function codeOf(p: Promise<unknown>) { try { await p; return null } catch (e) { return posErrorCode(e) } }

describe('probeDayo (spec 04 §7 ข้อ 1: test the key with E1 before saving it)', () => {
  it('names the device and lists the owners to choose from', async () => {
    const { t } = await fresh()
    const p = await t.api.probeDayo({ baseUrl: INPUT.baseUrl, apiKey: MOCK_API_KEY })
    expect(p).toMatchObject({ clientName: 'แท็บเล็ตขาย 1', lastReceiptNo: null, requiredPrefix: null, catalogVersion: 42, pricingMatches: true })
    expect(p.owners.map((o) => o.displayName)).toEqual(['TungAo', 'DCm'])
  })
  it.each([
    ['unauthorized', 'DAYO_BAD_KEY'], ['forbidden', 'DAYO_KEY_NO_SCOPE'], ['api_disabled', 'DAYO_API_DISABLED'], ['server_down', 'DAYO_UNREACHABLE'],
  ] as const)('mode %s → %s', async (mode, code) => {
    const { t, mock } = await fresh()
    mock.setMode(mode)
    expect(await codeOf(t.api.probeDayo({ baseUrl: INPUT.baseUrl, apiKey: MOCK_API_KEY }))).toBe(code)
  })
  it.each(['ftp://x/api/v1', 'http://dayo.example.com/api/v1', 'https://dayo.example.com/'])('refuses base URL %s', async (baseUrl) => {
    const { t } = await fresh()
    expect(await codeOf(t.api.probeDayo({ baseUrl, apiKey: MOCK_API_KEY }))).toBe('BAD_INPUT')
  })
})

describe('connectShop', () => {
  it('registers the device from E1 and the chosen owner with a local PIN', async () => {
    const { t } = await fresh()
    await t.api.connectShop(INPUT)
    const boot = await t.api.bootstrap()
    expect(boot).toMatchObject({ needsSetup: false, dayoLinked: true, legacyDevice: false, device: { name: 'แท็บเล็ตขาย 1', receiptPrefix: 'A' } })
    expect(boot.users).toEqual([{ id: STAFF.TungAo, displayName: 'TungAo', role: 'owner' }])
    expect(boot.staffNeedingPin.map((x) => x.displayName)).toEqual(['DCm', 'Beam', 'Mint', 'พนักงาน b2c3'])
    expect(await t.api.login(STAFF.TungAo, '1111')).toMatchObject({ role: 'owner' })
  })
  it('the API key is in the secret store and NOT in the SQLite file a backup exports (spec §6.9, §7)', async () => {
    const { t } = await fresh()
    await t.api.connectShop(INPUT)
    expect(await t.deps.secrets.getApiKey()).toBe(MOCK_API_KEY)
    expect(Buffer.from(vacuumInto(t.raw)).includes(Buffer.from(MOCK_API_KEY.slice(5)))).toBe(false)
  })
  it('keeps the receipt numbering of a reinstalled device (spec §6.6)', async () => {
    const { t, mock } = await fresh()
    mock.bumpCatalog((c) => { c.client = { ...c.client, last_receipt_no: 'B-000311' } })
    expect(await codeOf(t.api.connectShop(INPUT))).toBe('BAD_INPUT') // prefix A ≠ B
    await t.api.connectShop({ ...INPUT, receiptPrefix: 'B' })
    expect(await t.db.select().from(s.syncState).all()).toContainEqual({ key: 'dayo.last_receipt_no', value: 'B-000311' })
  })
  it('only an active owner from the dayo list may be the first owner', async () => {
    const { t } = await fresh()
    expect(await codeOf(t.api.connectShop({ ...INPUT, ownerStaffId: STAFF.Mint }))).toBe('BAD_INPUT')
  })
  it('a failed save leaves no key behind', async () => {
    const { t } = await fresh()
    expect(await codeOf(t.api.connectShop({ ...INPUT, promptPayId: 'nope' }))).toBe('BAD_INPUT')
    expect(await t.deps.secrets.getApiKey()).toBeNull()
  })
  it('after a 401 the owner sets a new key for the same receipt prefix (spec §6.3 row 401)', async () => {
    let active = createMockDayo({ now: '2026-09-25T02:00:00.120Z' })
    const t = await openTestApi({ fetch: (input, init) => active.fetch(input, init) })
    await t.api.connectShop(INPUT)
    await writeKey(t.db, DAYO_KEYS.apiState, 'unauthorized')
    const newKey = `dayo_${'a'.repeat(64)}`
    active = createMockDayo({ apiKey: newKey, now: '2026-09-25T02:00:00.120Z' })
    expect(await codeOf(t.api.replaceApiKey({ baseUrl: INPUT.baseUrl, apiKey: newKey, approverUserId: STAFF.TungAo, approverPin: '0000' }))).toBe('PIN_WRONG')
    await t.api.replaceApiKey({ baseUrl: INPUT.baseUrl, apiKey: newKey, approverUserId: STAFF.TungAo, approverPin: '1111' })
    expect(await t.deps.secrets.getApiKey()).toBe(newKey)
    expect(await readKey(t.db, DAYO_KEYS.apiState)).toBe('ok')
  })
  it('a plan-3/4 device links with an old owner PIN and keeps its prefix (ruling R7)', async () => {
    const { t } = await fresh()
    await t.api.setupShop({ deviceName: 'เครื่องเดิม', receiptPrefix: 'A', owners: [{ displayName: 'TungAo', pin: '9999' }], promptPayId: '0812345678' }) // the old API still exists until Task 22
    const old = (await t.api.bootstrap()).users[0]!
    expect((await t.api.bootstrap())).toMatchObject({ needsSetup: true, legacyDevice: true })
    expect(await codeOf(t.api.connectShop(INPUT))).toBe('ALREADY_SET_UP')
    await t.api.connectShop({ ...INPUT, legacyApproval: { userId: old.id, pin: '9999' } })
    const boot = await t.api.bootstrap()
    expect(boot.users.map((u) => u.id)).toEqual([STAFF.TungAo]) // the random-id plan-3 owner is disabled
    expect(boot.device?.name).toBe('เครื่องเดิม')
  })
  it('replaceApiKey refuses an approver dayo no longer lists as an active owner (ruling N2)', async () => {
    let active = createMockDayo({ now: '2026-09-25T02:00:00.120Z' })
    const t = await openTestApi({ fetch: (input, init) => active.fetch(input, init) })
    await t.api.connectShop(INPUT)
    await writeKey(t.db, DAYO_KEYS.apiState, 'unauthorized') // the tablet never saw TungAo's removal: the old key was revoked first
    const newKey = `dayo_${'a'.repeat(64)}`
    active = createMockDayo({ apiKey: newKey, now: '2026-09-25T02:00:00.120Z' })
    active.bumpCatalog((c) => { c.staff = c.staff.map((x) => (x.id === STAFF.TungAo ? { ...x, active: false } : x)) })
    expect(await codeOf(t.api.replaceApiKey({ baseUrl: INPUT.baseUrl, apiKey: newKey, approverUserId: STAFF.TungAo, approverPin: '1111' }))).toBe('NOT_OWNER')
    expect(await t.deps.secrets.getApiKey()).toBe(MOCK_API_KEY)
    expect((await t.api.bootstrap()).ownerRecovery).toBe(true) // key refused → recovery is offered
  })
})

/**
 * ruling N2: TungAo is the only owner with a PIN; dayo deactivates him. The owner logs in to the dayo web with LINE,
 * issues a new key, revokes the old one, then enters the new key here and gives DCm (an active dayo owner) a PIN.
 */
describe('recoverOwner — "เชื่อมใหม่ด้วยคีย์ใหม่" (ruling N2)', () => {
  const NEW_KEY = `dayo_${'b'.repeat(64)}`
  const REC = { baseUrl: INPUT.baseUrl, apiKey: NEW_KEY, ownerStaffId: STAFF.DCm, ownerPin: '2468' }
  const withoutTungAo = (c: { staff: { id: string; active: boolean }[] }) => { c.staff = c.staff.map((x) => (x.id === STAFF.TungAo ? { ...x, active: false } : x)) }
  /** Two dayo keys: the old one (MOCK_API_KEY) and the new one — requests go to the mock of the key they carry. */
  async function lockedOut() {
    const oldKey = createMockDayo({ now: '2026-09-25T02:00:00.120Z' })
    const newKey = createMockDayo({ apiKey: NEW_KEY, now: '2026-09-25T02:00:00.120Z' })
    const route: typeof fetch = (input, init) => (new Headers(init?.headers).get('Authorization') === `Bearer ${NEW_KEY}` ? newKey : oldKey).fetch(input, init)
    const t = await openTestApi({ fetch: route })
    await t.api.connectShop(INPUT)
    // a bill still waiting to be sent (Task 12 does not exist yet — the row is written directly; recovery must keep it)
    await t.db.insert(s.outbox).values({ id: 'ob-1', tableName: 'order', rowJson: { receipt_no: 'A-000001' }, idempotencyKey: 'order:x', status: 'pending', createdAt: '2026-09-25T02:00:00.000Z', attempts: 0 })
    oldKey.bumpCatalog(withoutTungAo); newKey.bumpCatalog(withoutTungAo)
    await pullCatalog({ db: t.db, deps: t.deps, serial: (fn) => fn() })
    return { t, oldKey, newKey }
  }
  it('is offered once no active owner with a PIN is left', async () => {
    const { t } = await lockedOut()
    const boot = await t.api.bootstrap()
    expect(boot.users.some((u) => u.role === 'owner')).toBe(false)
    expect(boot.ownerRecovery).toBe(true)
    expect(await codeOf(t.api.setStaffPin({ staffId: STAFF.DCm, pin: '2468', approverUserId: STAFF.TungAo, approverPin: '1111' }))).not.toBeNull() // the removed owner approves nothing
  })
  it('refuses while an owner with a PIN can still approve and the key works', async () => {
    const { t } = await fresh()
    await t.api.connectShop(INPUT)
    expect((await t.api.bootstrap()).ownerRecovery).toBe(false)
    expect(await codeOf(t.api.recoverOwner(REC))).toBe('RECOVERY_NOT_ALLOWED')
  })
  it('needs a NEW key, and the old key revoked on the web first', async () => {
    const { t, oldKey } = await lockedOut()
    expect(await codeOf(t.api.recoverOwner({ ...REC, apiKey: MOCK_API_KEY }))).toBe('KEY_NOT_NEW')
    expect(await codeOf(t.api.recoverOwner(REC))).toBe('OLD_KEY_STILL_ACTIVE')
    expect(await t.deps.secrets.getApiKey()).toBe(MOCK_API_KEY)
    oldKey.setMode('unauthorized') // the owner revoked it on the dayo web
    await t.api.recoverOwner(REC)
    expect(await t.deps.secrets.getApiKey()).toBe(NEW_KEY)
  })
  it('only an active dayo owner can be chosen, and the receipt prefix of the device stays', async () => {
    const { t, oldKey, newKey } = await lockedOut()
    oldKey.setMode('unauthorized')
    expect(await codeOf(t.api.recoverOwner({ ...REC, ownerStaffId: STAFF.TungAo }))).toBe('BAD_INPUT') // deactivated in dayo
    expect(await codeOf(t.api.recoverOwner({ ...REC, ownerStaffId: STAFF.Beam }))).toBe('BAD_INPUT')   // a manager
    newKey.bumpCatalog((c) => { c.client = { ...c.client, last_receipt_no: 'B-000009' } })
    expect(await codeOf(t.api.recoverOwner(REC))).toBe('BAD_INPUT') // this key belongs to a B- device
    expect(await t.deps.secrets.getApiKey()).toBe(MOCK_API_KEY)
  })
  it('gives the chosen owner a PIN, keeps the device and every queued row, and writes the audit trail without secrets', async () => {
    const { t, oldKey } = await lockedOut()
    const deviceBefore = (await t.api.bootstrap()).device
    const outboxBefore = await t.db.select().from(s.outbox).all()
    oldKey.setMode('unauthorized')
    await t.api.recoverOwner(REC)
    const boot = await t.api.bootstrap()
    expect(boot).toMatchObject({ ownerRecovery: false, needsSetup: false, device: deviceBefore })
    expect(await t.api.login(STAFF.DCm, '2468')).toMatchObject({ role: 'owner' })
    expect(await t.db.select().from(s.outbox).all()).toEqual(outboxBefore)
    expect(await readKey(t.db, DAYO_KEYS.apiState)).toBe('ok')
    const audit = JSON.stringify(t.raw.prepare(`select action, after_json from audit_log where action in ('owner_recovered', 'api_key_replaced')`).all())
    expect(audit).toMatch(/owner_recovered/)
    expect(audit.includes(NEW_KEY.slice(5)) || audit.includes('2468')).toBe(false)
  })
  it('also works when the key was revoked before the tablet saw the owner change (apiState unauthorized)', async () => {
    const { t } = await fresh()
    await t.api.connectShop(INPUT)
    await writeKey(t.db, DAYO_KEYS.apiState, 'unauthorized')
    expect((await t.api.bootstrap()).ownerRecovery).toBe(true)
  })
})

describe('dayo adjustments and security (Task 11 carried requirements)', () => {
  const NEW_KEY = `dayo_${'c'.repeat(64)}`
  /** A fetch that counts calls — a refused base URL must be refused before any of them. */
  function counting(mock: { fetch: typeof fetch }) { const calls = { n: 0 }; const f: typeof fetch = (i, init) => { calls.n++; return mock.fetch(i, init) }; return { calls, f } }

  it('a last_receipt_no that is not <prefix>-<6 digits> stops setup with DAYO_RECEIPT_NO_INVALID and writes nothing (spec §4.4 ข้อ 6 · A1)', async () => {
    const { t, mock } = await fresh()
    mock.bumpCatalog((c) => { c.client = { ...c.client, last_receipt_no: 'L260924-014' } })
    const before = await t.db.select().from(s.syncState).all()
    expect(await codeOf(t.api.probeDayo({ baseUrl: INPUT.baseUrl, apiKey: MOCK_API_KEY }))).toBe('DAYO_RECEIPT_NO_INVALID')
    expect(await codeOf(t.api.connectShop({ ...INPUT, receiptPrefix: 'L' }))).toBe('DAYO_RECEIPT_NO_INVALID')
    expect(await t.db.select().from(s.syncState).all()).toEqual(before)
    expect(await readKey(t.db, DAYO_KEYS.lastReceiptNo)).toBeNull()
    expect(await t.deps.secrets.getApiKey()).toBeNull()
    expect((await t.api.bootstrap()).device).toBeNull()
  })
  it('replaceApiKey and recoverOwner also refuse a malformed last_receipt_no and keep the old key', async () => {
    let active = createMockDayo({ now: '2026-09-25T02:00:00.120Z' })
    const t = await openTestApi({ fetch: (input, init) => active.fetch(input, init) })
    await t.api.connectShop(INPUT)
    await writeKey(t.db, DAYO_KEYS.apiState, 'unauthorized')
    active = createMockDayo({ apiKey: NEW_KEY, now: '2026-09-25T02:00:00.120Z' })
    active.bumpCatalog((c) => { c.client = { ...c.client, last_receipt_no: 'A000001' } })
    expect(await codeOf(t.api.replaceApiKey({ baseUrl: INPUT.baseUrl, apiKey: NEW_KEY, approverUserId: STAFF.TungAo, approverPin: '1111' }))).toBe('DAYO_RECEIPT_NO_INVALID')
    expect(await codeOf(t.api.recoverOwner({ baseUrl: INPUT.baseUrl, apiKey: NEW_KEY, ownerStaffId: STAFF.DCm, ownerPin: '2468' }))).toBe('DAYO_RECEIPT_NO_INVALID')
    expect(await t.deps.secrets.getApiKey()).toBe(MOCK_API_KEY)
    expect(await readKey(t.db, DAYO_KEYS.lastReceiptNo)).toBeNull()
  })
  it('pricingMatches compares files_sha256 only: a null commit still matches, a changed file does not', async () => {
    const { t, mock } = await fresh()
    mock.bumpCatalog((c) => { c.pricing = { ...c.pricing, commit: null } })
    expect((await t.api.probeDayo({ baseUrl: INPUT.baseUrl, apiKey: MOCK_API_KEY })).pricingMatches).toBe(true)
    mock.bumpCatalog((c) => { c.pricing = { ...c.pricing, files_sha256: { ...c.pricing.files_sha256, 'packages/shared/src/money.ts': '0'.repeat(64) } } })
    expect((await t.api.probeDayo({ baseUrl: INPUT.baseUrl, apiKey: MOCK_API_KEY })).pricingMatches).toBe(false)
  })
  it('a bad base URL is refused before any network call — probe, connect, replace and recover', async () => {
    const mock = createMockDayo({ now: '2026-09-25T02:00:00.120Z' })
    const { calls, f } = counting(mock)
    const t = await openTestApi({ fetch: f })
    const bad = 'http://dayo.example.com/api/v1'
    expect(await codeOf(t.api.probeDayo({ baseUrl: bad, apiKey: MOCK_API_KEY }))).toBe('BAD_INPUT')
    expect(await codeOf(t.api.connectShop({ ...INPUT, baseUrl: bad }))).toBe('BAD_INPUT')
    expect(calls.n).toBe(0)
    await t.api.connectShop(INPUT)
    await writeKey(t.db, DAYO_KEYS.apiState, 'unauthorized')
    const n = calls.n
    expect(await codeOf(t.api.replaceApiKey({ baseUrl: bad, apiKey: NEW_KEY, approverUserId: STAFF.TungAo, approverPin: '1111' }))).toBe('BAD_INPUT')
    expect(await codeOf(t.api.recoverOwner({ baseUrl: bad, apiKey: NEW_KEY, ownerStaffId: STAFF.DCm, ownerPin: '2468' }))).toBe('BAD_INPUT')
    expect(await codeOf(t.api.recoverOwner({ baseUrl: 'https://dayo.example.com/', apiKey: NEW_KEY, ownerStaffId: STAFF.DCm, ownerPin: '2468' }))).toBe('BAD_INPUT')
    expect(calls.n).toBe(n)
  })
  it('errors never echo the key or the PIN', async () => {
    const { t } = await fresh()
    const wrong = `dayo_${'d'.repeat(64)}`
    const messages: string[] = []
    for (const p of [
      t.api.probeDayo({ baseUrl: INPUT.baseUrl, apiKey: wrong }),
      t.api.probeDayo({ baseUrl: INPUT.baseUrl, apiKey: `${wrong}x` }),
      t.api.connectShop({ ...INPUT, apiKey: wrong, ownerPin: '97531' }),
      t.api.connectShop({ ...INPUT, ownerPin: '12ab' }),
    ]) { try { await p } catch (e) { messages.push(e instanceof Error ? e.message : String(e)) } }
    expect(messages).toHaveLength(4)
    expect(messages.some((m) => m.includes('d'.repeat(16)) || m.includes('97531') || m.includes('12ab'))).toBe(false)
  })
  it('replaceApiKey overwrites the old key: it is no longer readable, and neither key nor PIN is in the SQLite file', async () => {
    let active = createMockDayo({ now: '2026-09-25T02:00:00.120Z' })
    const t = await openTestApi({ fetch: (input, init) => active.fetch(input, init) })
    await t.api.connectShop(INPUT)
    active = createMockDayo({ apiKey: NEW_KEY, now: '2026-09-25T02:00:00.120Z' })
    await t.api.replaceApiKey({ baseUrl: INPUT.baseUrl, apiKey: NEW_KEY, approverUserId: STAFF.TungAo, approverPin: '1111' })
    expect(await t.deps.secrets.getApiKey()).toBe(NEW_KEY)
    const file = Buffer.from(vacuumInto(t.raw))
    expect(file.includes(Buffer.from(MOCK_API_KEY.slice(5)))).toBe(false)
    expect(file.includes(Buffer.from(NEW_KEY.slice(5)))).toBe(false)
    const audit = JSON.stringify(t.raw.prepare('select before_json, after_json from audit_log').all())
    expect(audit.includes('1111')).toBe(false)
  })
  it('a replaceApiKey that fails after the key check puts the previous key back (prefix of another device)', async () => {
    let active = createMockDayo({ now: '2026-09-25T02:00:00.120Z' })
    const t = await openTestApi({ fetch: (input, init) => active.fetch(input, init) })
    await t.api.connectShop(INPUT)
    active = createMockDayo({ apiKey: NEW_KEY, now: '2026-09-25T02:00:00.120Z' })
    active.bumpCatalog((c) => { c.client = { ...c.client, last_receipt_no: 'B-000009' } })
    expect(await codeOf(t.api.replaceApiKey({ baseUrl: INPUT.baseUrl, apiKey: NEW_KEY, approverUserId: STAFF.TungAo, approverPin: '1111' }))).toBe('BAD_INPUT')
    expect(await t.deps.secrets.getApiKey()).toBe(MOCK_API_KEY)
  })
  it('recoverOwner: an old key that is only forbidden (scope removed) still exists → OLD_KEY_STILL_ACTIVE; dayo unreachable → DAYO_UNREACHABLE', async () => {
    const oldKey = createMockDayo({ now: '2026-09-25T02:00:00.120Z' })
    const newKey = createMockDayo({ apiKey: NEW_KEY, now: '2026-09-25T02:00:00.120Z' })
    const route: typeof fetch = (input, init) => (new Headers(init?.headers).get('Authorization') === `Bearer ${NEW_KEY}` ? newKey : oldKey).fetch(input, init)
    const t = await openTestApi({ fetch: route })
    await t.api.connectShop(INPUT)
    await writeKey(t.db, DAYO_KEYS.apiState, 'unauthorized')
    const REC = { baseUrl: INPUT.baseUrl, apiKey: NEW_KEY, ownerStaffId: STAFF.DCm, ownerPin: '2468' }
    oldKey.setMode('forbidden')
    expect(await codeOf(t.api.recoverOwner(REC))).toBe('OLD_KEY_STILL_ACTIVE')
    oldKey.setMode('server_down')
    expect(await codeOf(t.api.recoverOwner(REC))).toBe('DAYO_UNREACHABLE')
    expect(await t.deps.secrets.getApiKey()).toBe(MOCK_API_KEY)
    oldKey.setMode('unauthorized')
    await t.api.recoverOwner(REC)
    expect(await t.deps.secrets.getApiKey()).toBe(NEW_KEY)
    const file = Buffer.from(vacuumInto(t.raw))
    expect(file.includes(Buffer.from(MOCK_API_KEY.slice(5))) || file.includes(Buffer.from(NEW_KEY.slice(5)))).toBe(false)
  })
})

/**
 * Fix round 1 (security C1/I1): recovery and key swaps stay on the stored dayo address. A caller-typed address that
 * differs is refused before any request, so neither the old key nor the new one ever reaches another server.
 */
describe('the same central address rule (fix round 1)', () => {
  const NEW_KEY = `dayo_${'e'.repeat(64)}`
  const EVIL = 'https://evil.example.com/api/v1'
  const ATTACKER = '9f8e7d6c-5b4a-4938-8271-6a5b4c3d2e1f'
  type Sent = { origin: string; auth: string | null }
  /** Real dayo = the old-key mock + the new-key mock on localhost; any other origin is a fake server that accepts anything. */
  async function linked() {
    const oldKey = createMockDayo({ now: '2026-09-25T02:00:00.120Z' })
    const newKey = createMockDayo({ apiKey: NEW_KEY, now: '2026-09-25T02:00:00.120Z' })
    const fake = createMockDayo({ apiKey: NEW_KEY, now: '2026-09-25T02:00:00.120Z' })
    fake.bumpCatalog((c) => { c.staff = [...c.staff, { id: ATTACKER, display_name: 'Mallory', role: 'owner', active: true }] })
    const sent: Sent[] = []
    const route: typeof fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      const auth = new Headers(init?.headers).get('Authorization')
      sent.push({ origin: url.origin, auth })
      if (url.origin !== 'http://localhost:8787') return fake.fetch(input, init)
      return (auth === `Bearer ${NEW_KEY}` ? newKey : oldKey).fetch(input, init)
    }
    const t = await openTestApi({ fetch: route })
    await t.api.connectShop(INPUT)
    return { t, oldKey, newKey, sent }
  }
  const foreign = (sent: Sent[]) => sent.filter((x) => x.origin !== 'http://localhost:8787')
  async function owners(t: Awaited<ReturnType<typeof linked>>['t']) {
    return (await t.db.select().from(s.user).all()).filter((u) => u.role === 'owner' && u.isActive).map((u) => u.id).sort()
  }

  it('(a) recovery to another origin is refused, and neither key is sent there', async () => {
    const { t, oldKey, sent } = await linked()
    await writeKey(t.db, DAYO_KEYS.apiState, 'unauthorized')
    oldKey.setMode('unauthorized')
    expect(await codeOf(t.api.recoverOwner({ baseUrl: EVIL, apiKey: NEW_KEY, ownerStaffId: STAFF.DCm, ownerPin: '2468' }))).toBe('RECOVERY_NOT_ALLOWED')
    expect(foreign(sent)).toEqual([])
    expect(await t.deps.secrets.getApiKey()).toBe(MOCK_API_KEY)
  })
  it('(b) stolen tablet: key revoked + a fake server listing the thief as owner → RECOVERY_NOT_ALLOWED, nothing changes', async () => {
    const { t, oldKey, sent } = await linked()
    await writeKey(t.db, DAYO_KEYS.apiState, 'unauthorized') // spec §7 ข้อ 3: the owner revoked the key of the stolen tablet
    oldKey.setMode('unauthorized')
    const before = await owners(t)
    expect(await codeOf(t.api.recoverOwner({ baseUrl: EVIL, apiKey: NEW_KEY, ownerStaffId: ATTACKER, ownerPin: '1234' }))).toBe('RECOVERY_NOT_ALLOWED')
    expect(await readKey(t.db, DAYO_KEYS.baseUrl)).toBe('http://localhost:8787/api/v1')
    expect(await owners(t)).toEqual(before)
    expect(await t.db.select().from(s.user).all()).not.toContainEqual(expect.objectContaining({ id: ATTACKER }))
    expect(foreign(sent)).toEqual([])
    expect(await t.deps.secrets.getApiKey()).toBe(MOCK_API_KEY)
  })
  it('(c) replaceApiKey to another address is refused and changes nothing', async () => {
    const { t, sent } = await linked()
    const syncBefore = await t.db.select().from(s.syncState).all()
    expect(await codeOf(t.api.replaceApiKey({ baseUrl: EVIL, apiKey: NEW_KEY, approverUserId: STAFF.TungAo, approverPin: '1111' }))).toBe('BAD_INPUT')
    expect(foreign(sent)).toEqual([])
    expect(await t.deps.secrets.getApiKey()).toBe(MOCK_API_KEY)
    expect(await t.db.select().from(s.syncState).all()).toEqual(syncBefore)
  })
  it('the same address written differently (trailing slash, upper-case host) still counts as the same', async () => {
    const { t } = await linked()
    await t.api.replaceApiKey({ baseUrl: ' http://LOCALHOST:8787/api/v1// ', apiKey: NEW_KEY, approverUserId: STAFF.TungAo, approverPin: '1111' })
    expect(await t.deps.secrets.getApiKey()).toBe(NEW_KEY)
  })
  it('(d) a missing or invalid stored base_url refuses recovery (the tablet needs a full setup)', async () => {
    const { t, oldKey, sent } = await linked()
    await writeKey(t.db, DAYO_KEYS.apiState, 'unauthorized')
    oldKey.setMode('unauthorized')
    const REC = { baseUrl: INPUT.baseUrl, apiKey: NEW_KEY, ownerStaffId: STAFF.DCm, ownerPin: '2468' }
    await deleteKey(t.db, DAYO_KEYS.baseUrl)
    const n = sent.length
    expect(await codeOf(t.api.recoverOwner(REC))).toBe('RECOVERY_NOT_ALLOWED')
    await writeKey(t.db, DAYO_KEYS.baseUrl, 'http://evil.example.com/api/v1') // e.g. brought by a restored backup
    expect(await codeOf(t.api.recoverOwner({ ...REC, baseUrl: 'http://evil.example.com/api/v1' }))).toBe('BAD_INPUT') // typed: refused by the shared rule
    expect(await codeOf(t.api.recoverOwner(REC))).toBe('RECOVERY_NOT_ALLOWED')
    expect(sent.length).toBe(n)
    expect(await t.deps.secrets.getApiKey()).toBe(MOCK_API_KEY)
  })
  it('M3 (fix round 1): a stored base_url the shared rule refuses gives bootstrap().dayoBaseUrl null, never the raw value', async () => {
    const { t } = await linked()
    await writeKey(t.db, DAYO_KEYS.baseUrl, 'not a url at all')
    expect((await t.api.bootstrap()).dayoBaseUrl).toBeNull()
  })
})

describe('fix round 1: linking state, PIN reset audit, rollback after the key swap', () => {
  it('M1: a key without a stored base_url does not leave the device stuck at ALREADY_SET_UP', async () => {
    const { t } = await fresh()
    await t.api.connectShop(INPUT)
    expect(await codeOf(t.api.connectShop(INPUT))).toBe('ALREADY_SET_UP') // really linked
    await deleteKey(t.db, DAYO_KEYS.baseUrl) // the key is still in the secret store
    expect(await t.api.bootstrap()).toMatchObject({ dayoLinked: false, needsSetup: true, legacyDevice: true })
    await t.api.connectShop({ ...INPUT, legacyApproval: { userId: STAFF.TungAo, pin: '1111' } })
    expect(await t.api.bootstrap()).toMatchObject({ dayoLinked: true, needsSetup: false })
  })
  it('M1: a key left over on a device with no row is overwritten by setup', async () => {
    const { t } = await fresh()
    await t.deps.secrets.setApiKey(`dayo_${'f'.repeat(64)}`)
    await t.api.connectShop(INPUT)
    expect(await t.deps.secrets.getApiKey()).toBe(MOCK_API_KEY)
  })
  it('a legacy device keeps its prefix: another prefix fails before any key is stored', async () => {
    const { t, mock } = await fresh()
    await t.api.setupShop({ deviceName: 'เครื่องเดิม', receiptPrefix: 'A', owners: [{ displayName: 'TungAo', pin: '9999' }], promptPayId: '0812345678' })
    const old = (await t.api.bootstrap()).users[0]!
    const calls = mock.requests().length
    expect(await codeOf(t.api.connectShop({ ...INPUT, receiptPrefix: 'B', legacyApproval: { userId: old.id, pin: '9999' } }))).toBe('BAD_INPUT')
    expect(mock.requests().length).toBe(calls) // refused before E1
    expect(await t.deps.secrets.getApiKey()).toBeNull()
  })
  it('connectShop: a save that fails after the key was stored leaves no key behind', async () => {
    const { t } = await fresh()
    await t.api.setupShop({ deviceName: 'เครื่องเดิม', receiptPrefix: 'A', owners: [{ displayName: 'TungAo', pin: '9999' }], promptPayId: '0812345678' })
    const old = (await t.api.bootstrap()).users[0]!
    const newId = t.deps.newId
    t.deps.newId = () => { throw new Error('injected fault') }
    await expect(t.api.connectShop({ ...INPUT, legacyApproval: { userId: old.id, pin: '9999' } })).rejects.toThrow('injected fault')
    t.deps.newId = newId
    expect(await t.deps.secrets.getApiKey()).toBeNull()
    expect(await readKey(t.db, DAYO_KEYS.baseUrl)).toBeNull()
  })
  it('replaceApiKey and recoverOwner: a save that fails after the swap puts the previous key back', async () => {
    const NEW_KEY = `dayo_${'a'.repeat(64)}`
    const oldKey = createMockDayo({ now: '2026-09-25T02:00:00.120Z' })
    const newKey = createMockDayo({ apiKey: NEW_KEY, now: '2026-09-25T02:00:00.120Z' })
    const route: typeof fetch = (input, init) => (new Headers(init?.headers).get('Authorization') === `Bearer ${NEW_KEY}` ? newKey : oldKey).fetch(input, init)
    const t = await openTestApi({ fetch: route })
    await t.api.connectShop(INPUT)
    const newId = t.deps.newId
    t.deps.newId = () => { throw new Error('injected fault') }
    await expect(t.api.replaceApiKey({ baseUrl: INPUT.baseUrl, apiKey: NEW_KEY, approverUserId: STAFF.TungAo, approverPin: '1111' })).rejects.toThrow('injected fault')
    expect(await t.deps.secrets.getApiKey()).toBe(MOCK_API_KEY)
    await writeKey(t.db, DAYO_KEYS.apiState, 'unauthorized')
    oldKey.setMode('unauthorized')
    await expect(t.api.recoverOwner({ baseUrl: INPUT.baseUrl, apiKey: NEW_KEY, ownerStaffId: STAFF.DCm, ownerPin: '2468' })).rejects.toThrow('injected fault')
    expect(await t.deps.secrets.getApiKey()).toBe(MOCK_API_KEY)
    t.deps.newId = newId
    await t.api.recoverOwner({ baseUrl: INPUT.baseUrl, apiKey: NEW_KEY, ownerStaffId: STAFF.DCm, ownerPin: '2468' })
    expect(await t.deps.secrets.getApiKey()).toBe(NEW_KEY)
  })
})
