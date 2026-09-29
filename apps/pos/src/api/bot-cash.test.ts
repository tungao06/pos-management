import { describe, expect, it } from 'vitest'
import { BOT_NAME_MAX, BOT_SOURCE_MAX, checkedBotBills } from './bot-cash'

const window = { after: '2026-09-24T17:00:00.000Z', until: '2026-09-25T05:00:00.000Z' }
const bill = (over: Record<string, unknown> = {}) => ({ order_no: 'L260925-901', version: 1, source: 'line', sold_at: '2026-09-25T04:00:00.000Z', total: 70, created_by_name: 'DCm', ...over })

// final fix S2: E4's `source` and `created_by_name` are dayo's free text — frozen into the Z snapshot, so bounded here
// (code points, like every other name the tablet keeps from dayo), never trusted to be small.
describe('checkedBotBills — dayo text is bounded before it reaches the Z (final fix S2)', () => {
  it('clips an oversized source and created_by_name (Thai: 3 bytes a code point) and keeps the money', () => {
    const r = checkedBotBills({ bills: [bill({ source: 'l'.repeat(10_000), created_by_name: 'ส'.repeat(10_000) })], cash_total: 70 }, window)
    expect([...r.bills[0]!.source]).toHaveLength(BOT_SOURCE_MAX)
    expect([...r.bills[0]!.createdByName!]).toHaveLength(BOT_NAME_MAX)
    expect(r.bills[0]!.createdByName).toBe('ส'.repeat(BOT_NAME_MAX))
    expect(r).toMatchObject({ cashTotalSatang: 7_000, bills: [{ orderNo: 'L260925-901', totalSatang: 7_000 }] })
  })
  it('never splits a surrogate pair; short text and a null name pass unchanged', () => {
    const r = checkedBotBills({ bills: [bill({ created_by_name: '😀'.repeat(BOT_NAME_MAX + 5) }), bill({ order_no: 'L260925-902', created_by_name: null, source: 'web' })], cash_total: 140 }, window)
    expect(r.bills[0]!.createdByName).toBe('😀'.repeat(BOT_NAME_MAX))
    expect(r.bills[1]).toMatchObject({ source: 'web', createdByName: null })
  })
  it('the bounds are sensible: a name like the other dayo names (100), a source code (40)', () => {
    expect(BOT_NAME_MAX).toBe(100)
    expect(BOT_SOURCE_MAX).toBe(40)
  })
})
