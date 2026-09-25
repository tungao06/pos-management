import { describe, expect, it } from 'vitest'
import { posErrorCode } from '../src/api/errors'
import { openConnectedApi, STAFF } from './helpers/dayo'

describe('setStaffPin (spec 04 §6.5: a new staff member gets a PIN approved by an owner PIN)', () => {
  it('Mint can log in after an owner sets her PIN', async () => {
    const t = await openConnectedApi()
    await t.api.setStaffPin({ staffId: STAFF.Mint, pin: '4321', approverUserId: STAFF.TungAo, approverPin: '1111' })
    expect(await t.api.login(STAFF.Mint, '4321')).toMatchObject({ displayName: 'Mint', role: 'staff' })
    expect((await t.api.bootstrap()).staffNeedingPin.map((x) => x.displayName)).not.toContain('Mint')
  })
  it('needs an owner PIN, not a manager one', async () => {
    const t = await openConnectedApi()
    await t.api.setStaffPin({ staffId: STAFF.Beam, pin: '5555', approverUserId: STAFF.TungAo, approverPin: '1111' })
    try { await t.api.setStaffPin({ staffId: STAFF.Mint, pin: '4321', approverUserId: STAFF.Beam, approverPin: '5555' }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('NOT_OWNER') }
  })
  it('refuses a removed staff member', async () => {
    const t = await openConnectedApi()
    try { await t.api.setStaffPin({ staffId: STAFF.Old, pin: '4321', approverUserId: STAFF.TungAo, approverPin: '1111' }); expect.unreachable() } catch (e) { expect(posErrorCode(e)).toBe('BAD_INPUT') }
  })
  it('the audit row never holds the PIN', async () => {
    const t = await openConnectedApi()
    await t.api.setStaffPin({ staffId: STAFF.Mint, pin: '4321', approverUserId: STAFF.TungAo, approverPin: '1111' })
    const rows = t.raw.prepare(`select after_json from audit_log where entity = 'user' and entity_id = ?`).all(STAFF.Mint) as { after_json: string }[]
    expect(rows.some((r) => r.after_json.includes('4321'))).toBe(false)
  })
})
