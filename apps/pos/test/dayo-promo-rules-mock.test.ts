// Plan 10 Task 5: the test helper can link the tablet to a mock playing dayo f4cda56 (promotion rules + manual fields).
import { describe, expect, it } from 'vitest'
import { MOCK_API_KEY } from '@dayo/dayo-mock'
import { pushOnce } from '../src/sync/push'
import { openConnectedApi } from './helpers/dayo'
import { sellCode } from './helpers/db'

type E1 = { data: { supported_fields: Record<string, unknown>; catalog?: Record<string, unknown> } }
const e1 = async (t: Awaited<ReturnType<typeof openConnectedApi>>): Promise<E1> =>
  (await (await t.mock.fetch('http://mock/api/v1/pos/catalog?known_version=0&promo_rule_version=2', { headers: { authorization: `Bearer ${MOCK_API_KEY}` } })).json()) as E1

describe('openConnectedApi({ promoRules })', () => {
  it('links the tablet to a dayo with rule versions [1, 2] and manual fields; a bill without manual promotions is accepted as before', async () => {
    const t = await openConnectedApi({ promoRules: { versions: [1, 2], manualFields: true } })
    const answer = await e1(t)
    expect(answer.data.supported_fields['promotion_rule_versions']).toEqual([1, 2])
    expect(answer.data.supported_fields['order']).toContain('manual_promotion_ids')
    expect(answer.data.catalog).toHaveProperty('promotionGroups')
    await sellCode(t, [{ code: 'Cocoa', qty: 1 }], { method: 'PROMPTPAY' })
    expect(await pushOnce({ db: t.db, deps: t.deps, serial: (fn) => fn() })).toMatchObject({ sent: 1, stopped: null })
    expect(t.mock.orders()).toHaveLength(1)
  })
  it('defaults to a dayo before 0069 (no rule versions, no manual fields, no groups)', async () => {
    const answer = await e1(await openConnectedApi())
    expect(answer.data.supported_fields).not.toHaveProperty('promotion_rule_versions')
    expect(answer.data.supported_fields['order']).not.toContain('manual_promotion_ids')
    expect(answer.data.catalog).not.toHaveProperty('promotionGroups')
  })
})
