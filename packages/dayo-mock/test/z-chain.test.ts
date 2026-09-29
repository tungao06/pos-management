// z_no order and the Z chain (spec 04 §4.10 rules 0–6 + §13.8 R5-3) · dayo main 0066:519-550 (phase 1: rules 0, 1, 2, 3
// prev_hash, 5) · rule 3's `after` and rule 4 are dayo phase 2 — mock-only diagnostics (chainMismatch/notes), never on the wire.
// E1 last_z_until comes in dayo's `…mmm+00:00` form (0067:155 · preflight P7/D8).
import { describe, expect, it } from 'vitest'
import { MOCK_API_KEY } from '../src/index'
import { at, botBill, cashCount, cid, emptyZ, H, MIDNIGHT, newMock, pg, push, row, shiftClose, shiftOpen, sid } from './helpers-block3'

const zOf = (mock: ReturnType<typeof newMock>, zNo: number) => mock.zReports().find((z) => z.zNo === zNo)!
const e1 = async (mock: ReturnType<typeof newMock>) => ((await (await mock.fetch('http://localhost:8787/api/v1/pos/catalog?known_version=0', { headers: { authorization: `Bearer ${MOCK_API_KEY}` } })).json()) as { data: { client: Record<string, unknown> } }).data.client

describe('z_no order and the Z chain (spec 04 §4.10 rules 0–6)', () => {
  it('rule 2: the first Z of the key is not chain-checked', async () => {
    const mock = newMock()
    expect((await emptyZ(mock, 1, 1, at(1), { prevHash: 'ff'.repeat(32) })).at(-1)).toMatchObject({ status: 'accepted' })
    expect(zOf(mock, 1)).toMatchObject({ firstOfKey: true, chainBreak: false, notes: [], chainMismatch: [], quarantined: false })
  })
  it('rule 3: Z n after Z n−1 needs prev_hash = its hash (else chain_break) and after = its until (else mismatch)', async () => {
    const mock = newMock()
    await emptyZ(mock, 1, 1, at(1))
    await emptyZ(mock, 2, 2, at(2), { prevHash: H(1), after: at(1) })
    expect(zOf(mock, 2)).toMatchObject({ chainBreak: false, chainMismatch: [] })
    await emptyZ(mock, 3, 3, at(3), { prevHash: H(9), after: at(2) })
    expect(zOf(mock, 3)).toMatchObject({ chainBreak: true, chainMismatch: [] })
    await emptyZ(mock, 4, 4, at(4), { prevHash: H(3), after: at(3, 30) })
    expect(zOf(mock, 4)).toMatchObject({ chainBreak: false, chainMismatch: ['bot_window.after ≠ until ของ Z ใบก่อน'] })
  })
  it('rule 1: a z_no already used = CONFLICT "z_no_taken:" + the S5 flag, and the Z is not stored', async () => {
    const mock = newMock()
    await emptyZ(mock, 1, 1, at(1))
    const r = await emptyZ(mock, 2, 1, at(2), { prevHash: H(1), after: at(1) })
    expect(r.at(-1)).toMatchObject({ status: 'rejected', reason: 'CONFLICT' })
    expect(r.at(-1)!.detail!.startsWith('z_no_taken:')).toBe(true)
    expect(mock.conflicts()).toContain(`z_no_taken:${sid(2)}`)
    expect(mock.zReports()).toHaveLength(1)
  })
  it('rule 0: z_no above the highest + 50 = INVALID "data_conflict:" + the S5 flag; + 50 itself passes (R5-2)', async () => {
    const mock = newMock()
    await emptyZ(mock, 1, 1, at(1))
    const r = await emptyZ(mock, 2, 52, at(2))
    expect(r.at(-1)).toMatchObject({ status: 'rejected', reason: 'INVALID' })
    expect(r.at(-1)!.detail!.startsWith('data_conflict:')).toBe(true)
    expect(mock.conflicts()).toContain(`z_no_ceiling:${sid(2)}`)
    expect((await emptyZ(mock, 3, 51, at(3))).at(-1)).toMatchObject({ status: 'accepted' })
  })
  it('a Z whose counted ≠ the count in dayo = INVALID "data_conflict:" + the S5 flag (R5-2)', async () => {
    const mock = newMock()
    const r = await push(mock, [row('shift_open', sid(1), shiftOpen(1)), row('cash_count', cid(1), cashCount(1, at(1), 500)), row('shift_close', sid(1), shiftClose(1, { zNo: 1, countedAt: at(1), counted: 600 }))])
    expect(r.at(-1)).toMatchObject({ status: 'rejected', reason: 'INVALID' })
    expect(r.at(-1)!.detail!.startsWith('data_conflict:')).toBe(true)
    expect(mock.conflicts()).toContain(`counted_mismatch:${sid(1)}`)
  })
  it('rules 4–5: Z 6 before Z 5 gets a gap note (no chain_break); Z 5 then fills the gap and chains cleanly', async () => {
    const mock = newMock()
    await emptyZ(mock, 4, 4, at(4))
    await push(mock, [row('shift_open', sid(5), shiftOpen(5)), row('cash_count', cid(5), cashCount(5, at(5), 500))]) // shift 5 counted, its Z not sent yet
    await emptyZ(mock, 6, 6, at(6), { prevHash: H(5), after: at(5) })
    expect(zOf(mock, 6)).toMatchObject({ chainBreak: false, chainMismatch: [], notes: ['Z ขาดช่วง / Z ก่อนหน้ายังไม่มี'] })
    await push(mock, [row('shift_close', sid(5), shiftClose(5, { zNo: 5, countedAt: at(5), counted: 500, prevHash: H(4), after: at(4) }))])
    expect(zOf(mock, 5)).toMatchObject({ chainBreak: false, chainMismatch: [], quarantined: false })
  })
  it('rule 4: a gap whose after is not the latest count and the uncovered span has bot cash = mismatch', async () => {
    const mock = newMock()
    await emptyZ(mock, 1, 1, at(1))
    mock.seedCentralOrders([botBill('L260925-901', 70, '2026-09-25T02:30:00+00:00')])
    await push(mock, [row('shift_open', sid(2), shiftOpen(2)), row('cash_count', cid(2), cashCount(2, at(2), 500))]) // Z 2 never comes
    await emptyZ(mock, 3, 3, at(4), { prevHash: H(2), after: at(3) })                   // latest count before it is 02:00, after says 03:00
    expect(zOf(mock, 3).chainMismatch).toEqual(['ช่วงบิลบอทไม่ต่อกับการนับล่าสุด และช่วงนั้นมีบิลเงินสดบอท'])
  })
  it('rule 5: a lower z_no whose counted_at is not between its neighbours is quarantined: chain_break + mismatch on itself', async () => {
    const mock = newMock()
    await emptyZ(mock, 4, 4, at(4))
    await emptyZ(mock, 6, 6, at(6), { prevHash: H(5), after: at(5) })
    const r = await emptyZ(mock, 5, 5, at(7), { prevHash: H(4), after: at(4) })          // a replay: 07:00 is after Z 6's 06:00
    expect(r.at(-1)).toMatchObject({ status: 'accepted' })                                // dayo accepts a quarantined Z (0066:528-558)
    expect(zOf(mock, 5)).toMatchObject({ quarantined: true, chainBreak: true, chainMismatch: ['Z เลขต่ำผิดลำดับเวลา (เล่นซ้ำ)'] })
  })
  it('R5-3: a good Z next to a quarantined one is judged as if it were not there and stays clean', async () => {
    const mock = newMock()
    await emptyZ(mock, 4, 4, at(4))
    await emptyZ(mock, 6, 6, at(6), { prevHash: H(5), after: at(5) })
    await emptyZ(mock, 5, 5, at(7), { prevHash: H(4), after: at(4) })                   // quarantined
    await emptyZ(mock, 7, 7, at(8), { prevHash: H(6), after: at(6) })                   // its previous Z is Z 6, not the quarantined Z 5
    expect(zOf(mock, 7)).toMatchObject({ quarantined: false, chainBreak: false, chainMismatch: [], notes: [] })
    expect(zOf(mock, 6)).toMatchObject({ chainBreak: false, chainMismatch: [] })          // never re-judged against Z 5
  })
  it('E1 client: last_z_* come from the highest non-quarantined Z; without any Z the values bumpCatalog set survive (review item 3)', async () => {
    const mock = newMock()
    mock.bumpCatalog((c) => { Object.assign(c.client as Record<string, unknown>, { last_z_no: 41, last_z_hash: null, last_z_until: null }) })
    expect(await e1(mock)).toMatchObject({ last_z_no: 41, last_z_hash: null, last_z_until: null })       // no Z → untouched
    mock.preloadZ({ zNo: 41, hash: H(41), countedAt: '2026-09-24T12:00:00.000Z' })
    expect(await e1(mock)).toMatchObject({ last_z_no: 41, last_z_hash: H(41), last_z_until: '2026-09-24T12:00:00.000+00:00' })
    await emptyZ(mock, 1, 42, at(1), { prevHash: H(41), after: '2026-09-24T12:00:00.000Z' })
    expect(zOf(mock, 42)).toMatchObject({ firstOfKey: false, chainBreak: false, chainMismatch: [] })   // the preloaded Z is its previous one
    expect(await e1(mock)).toMatchObject({ last_z_no: 42, last_z_hash: H(42), last_z_until: pg(at(1)) })
  })
  it('R5-3 scope: a Z above the highest with an OLDER counted_at is not quarantined — rule 3 flags its after instead', async () => {
    const mock = newMock()
    await emptyZ(mock, 2, 1, at(5))
    await emptyZ(mock, 1, 2, at(3), { prevHash: H(1), after: MIDNIGHT })                  // z_no 2 > highest 1, counted before Z 1
    expect(zOf(mock, 2)).toMatchObject({ quarantined: false, chainBreak: false, chainMismatch: ['bot_window.after ≠ until ของ Z ใบก่อน'] })
  })
  it('R5-3 sticky: a later recompute never quarantines or releases a Z', async () => {
    const mock = newMock()
    await emptyZ(mock, 4, 4, at(4)); await emptyZ(mock, 6, 6, at(6), { prevHash: H(5), after: at(5) })
    await emptyZ(mock, 5, 5, at(7), { prevHash: H(4), after: at(4) })                     // quarantined at receipt
    await emptyZ(mock, 7, 7, at(8), { prevHash: H(6), after: at(6) })                     // recomputes run again (Task 8 recomputeAll)
    expect([4, 5, 6, 7].map((n) => zOf(mock, n).quarantined)).toEqual([false, true, false, false])
  })
  it('E1 after a quarantine: last_z_no counts every Z, hash/until come from the highest good Z (R5-3 · plan 08 rule)', async () => {
    const mock = newMock()
    await emptyZ(mock, 4, 4, at(4)); await emptyZ(mock, 6, 6, at(6), { prevHash: H(5), after: at(5) })
    await emptyZ(mock, 5, 5, at(7), { prevHash: H(4), after: at(4) })                     // quarantined
    expect(await e1(mock)).toMatchObject({ last_z_no: 6, last_z_hash: H(6), last_z_until: pg(at(6)) })
    // Through pushes a quarantined Z can never be the highest (rule 1 refuses an equal number; rule 5 needs a higher one).
    // Pin the split rule anyway, as plan 08's SQL does: make the quarantined Z the highest by hand (test-only state write).
    const z5 = mock.zReports().find((z) => z.zNo === 5)!
    const z6 = mock.zReports().find((z) => z.zNo === 6)!
    z5.zNo = 7                                                                             // mock.zReports() returns the live state objects
    expect(z6.quarantined).toBe(false)
    expect(await e1(mock)).toMatchObject({ last_z_no: 7, last_z_hash: H(6), last_z_until: pg(at(6)) }) // number includes the quarantined Z · hash/until from the good one
  })
  it('a Z re-sent under its key = duplicate {shift_id}; changed content under the key = CONFLICT key_changed: + S5 (0066:506-518)', async () => {
    const mock = newMock()
    await emptyZ(mock, 1, 1, at(1))
    const z = shiftClose(1, { zNo: 1, countedAt: at(1), counted: 500 })
    expect((await push(mock, [row('shift_close', sid(1), z)]))[0]).toEqual({ key: `shift_close:${sid(1)}`, status: 'duplicate', data: { shift_id: sid(1) } })
    const changed = await push(mock, [row('shift_close', sid(1), { ...z, variance_reason: 'นับใหม่' })])
    expect(changed[0]).toMatchObject({ status: 'rejected', reason: 'CONFLICT' })
    expect(changed[0]!.detail!.startsWith('key_changed:')).toBe(true)
    expect(mock.conflicts()).toEqual([`key_changed:${sid(1)}`])
    expect(mock.shifts().find((x) => x.id === sid(1))).toMatchObject({ status: 'closed', dataConflict: true })
  })
})
