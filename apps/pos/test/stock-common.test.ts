import { describe, expect, it } from 'vitest'
import * as s from '@dayo/db-schema/sqlite'
import { cleanText, requireStockItem } from '../src/api/stock-common'
import { openReadyApi } from './helpers/db'
import { itemId } from './helpers/stock'

describe('cleanText — every Unicode format character, not just the handful first listed (review I-1 · m-1, Task 3 fix round 1)', () => {
  it('strips U+2060 WORD JOINER (I-1: dropped by the old [\\u200B-\\u200D\\uFEFF] class)', () => {
    expect(cleanText('a⁠b', 'x', true)).toBe('ab')
  })

  it('strips U+200E LEFT-TO-RIGHT MARK (m-1: outside the old class entirely)', () => {
    expect(cleanText('a‎b', 'x', true)).toBe('ab')
  })

  it('a reason made only of invisible format characters is empty, and required refuses it', () => {
    expect(() => cleanText('⁠‎​﻿', 'reason', true)).toThrow(/^BAD_INPUT: reason is required$/)
    // not required: an all-invisible reason is simply the empty string
    expect(cleanText('⁠‎​﻿', 'reason', false)).toBe('')
  })
})

describe('requireStockItem — inactive items (controller ruling I-2, Task 3 fix round 1)', () => {
  it('an inactive item is refused by default, whatever its stock (receivePurchase / produceBase never opt in)', async () => {
    const t = await openReadyApi()
    const id = await itemId(t, 'RM-MLK-03')
    t.raw.prepare('update item set is_active = 0 where id = ?').run(id)
    await t.db.insert(s.itemCostState).values({ itemId: id, onHandMilli: -16, avgCostUsat: 1_000, asOfMovementId: null, updatedAt: t.deps.now() })
    await expect(requireStockItem(t.db, id, ['raw'])).rejects.toThrow(/^BAD_INPUT: /)
  })

  it('allowInactiveWithStock accepts an inactive item only while its on-hand is not exactly 0', async () => {
    const t = await openReadyApi()
    const id = await itemId(t, 'RM-MLK-03')
    t.raw.prepare('update item set is_active = 0 where id = ?').run(id)
    // no movement yet: on-hand is 0 — still refused, even with the flag (nothing left to count out)
    await expect(requireStockItem(t.db, id, ['raw'], { allowInactiveWithStock: true })).rejects.toThrow(/^BAD_INPUT: /)
    await t.db.insert(s.itemCostState).values({ itemId: id, onHandMilli: -16, avgCostUsat: 1_000, asOfMovementId: null, updatedAt: t.deps.now() })
    const item = await requireStockItem(t.db, id, ['raw'], { allowInactiveWithStock: true })
    expect(item.id).toBe(id)
  })
})
