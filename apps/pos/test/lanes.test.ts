import { describe, expect, it } from 'vitest'
import { createLanePicker, type QueueRow } from '../src/sync/lanes'

const NOW = '2026-09-25T12:00:00.000Z'
const BIG = { maxRows: 20, maxBytes: 262_144 }
const r = (key: string, over: Partial<QueueRow> = {}): QueueRow => ({ id: key, kind: key.split(':')[0]!, key, createdAt: NOW, nextAttemptAt: null, parentKey: null, supported: true, bytes: 300, ...over })
const pick = (p: ReturnType<typeof createLanePicker>, rows: QueueRow[]) => rows.filter((x) => p.offer(x)).map((x) => x.key)

describe('lanes (spec 04 §6.2)', () => {
  it('a shift-lane row that cannot go holds every later shift-lane row, bills keep going', () => {
    const p = createLanePicker(() => 'sent', NOW, BIG)
    expect(pick(p, [r('shift_open:a', { nextAttemptAt: '2026-09-25T12:00:05.000Z' }), r('order:1'), r('cash_movement:m', { parentKey: 'shift_open:a' }), r('shift_open:b'), r('order:2')])).toEqual(['order:1', 'order:2'])
  })
  it('a child goes in the same batch right after its parent', () => {
    const p = createLanePicker((k) => (k === 'shift_open:a' ? 'pending' : 'sent'), NOW, BIG)
    expect(pick(p, [r('shift_open:a'), r('cash_count:c', { parentKey: 'shift_open:a' }), r('shift_close:a', { parentKey: 'cash_count:c' })])).toEqual(['shift_open:a', 'cash_count:c', 'shift_close:a'])
  })
  it('an order_void waits for an order that is not sent and not earlier in the batch (block 2 rule kept)', () => {
    const p = createLanePicker(() => 'pending', NOW, BIG)
    expect(p.offer(r('order_void:1', { parentKey: 'order:1' }))).toBe(false)
  })
  it('an unsupported shift row also holds the lane (held, never counted)', () => {
    const p = createLanePicker(() => 'sent', NOW, BIG)
    expect(pick(p, [r('shift_open:a', { supported: false }), r('shift_open:b')])).toEqual([])
  })
  it('a large shift_close that does not fit the bytes left closes the shift lane for this batch; later bills still fit (review item 6)', () => {
    const p = createLanePicker((k) => (k === 'shift_open:a' || k === 'cash_count:c' ? 'pending' : 'sent'), NOW, { maxRows: 20, maxBytes: 1_000 })
    expect(pick(p, [r('shift_open:a'), r('cash_count:c', { parentKey: 'shift_open:a' }), r('shift_close:a', { parentKey: 'cash_count:c', bytes: 900 }), r('shift_open:b', { bytes: 10 }), r('order:1')]))
      .toEqual(['shift_open:a', 'cash_count:c', 'order:1'])
  })
  it('the shift lane also closes when the row count is used up; only rows actually placed count as taken parents', () => {
    const p = createLanePicker(() => 'pending', NOW, { maxRows: 1, maxBytes: 262_144 })
    expect(pick(p, [r('order:1'), r('shift_open:a'), r('cash_movement:m', { parentKey: 'shift_open:a' })])).toEqual(['order:1'])
    expect(p.full()).toBe(true)
  })
  it('a row bigger than an EMPTY batch is reported as oversized (→ dead ENVELOPE) and closes the shift lane for this pass (round 2 item 4)', () => {
    const p = createLanePicker(() => 'sent', NOW, BIG)
    expect(pick(p, [r('shift_close:a', { bytes: 300_000 }), r('shift_open:b'), r('order:1')])).toEqual(['order:1'])
    expect(p.oversized().map((x) => x.key)).toEqual(['shift_close:a'])
  })
  it('a bill that does not fit is skipped; a smaller one after it still goes', () => {
    const p = createLanePicker(() => 'sent', NOW, { maxRows: 20, maxBytes: 1_000 })
    expect(pick(p, [r('order:1', { bytes: 800 }), r('order:2', { bytes: 800 }), r('order:3', { bytes: 100 })])).toEqual(['order:1', 'order:3'])
  })
  // Task 10 Step 0 (block 2 push.test.ts M5 kept): a parent that is not on this tablet at all never arrives from here —
  // the child is not held for it; dayo judges it (PARENT_PENDING, counted → STUCK at 50 → the problems page).
  it('a parent with no outbox row does not hold its child — in either lane', () => {
    const p = createLanePicker(() => 'missing', NOW, BIG)
    expect(pick(p, [r('order_void:1', { parentKey: 'order:1' }), r('cash_movement:m', { parentKey: 'shift_open:a' })])).toEqual(['order_void:1', 'cash_movement:m'])
  })
  it('a parent closed as off-catalog, dead or local only holds its child (pushOnce moves those children first)', () => {
    for (const st of ['closed_off_catalog', 'dead', 'local_only'] as const) {
      const p = createLanePicker(() => st, NOW, BIG)
      expect(p.offer(r('order_void:1', { parentKey: 'order:1' }))).toBe(false)
    }
  })
  it('a row due exactly now goes; a shift row after a closed lane never goes even when it could', () => {
    const p = createLanePicker(() => 'sent', NOW, BIG)
    expect(pick(p, [r('shift_open:a', { nextAttemptAt: NOW }), r('cash_movement:m', { parentKey: 'shift_open:x', supported: false }), r('shift_open:b')])).toEqual(['shift_open:a'])
  })
})
