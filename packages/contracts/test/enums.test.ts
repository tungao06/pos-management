import { describe, expect, it } from 'vitest'
import { EventType, OutboxStatus, ShiftStatus, ShiftSyncMode } from '../src/enums'

describe('block 3 enums', () => {
  it('shift lifecycle, sync mode, outbox status and events', () => {
    expect(ShiftStatus.options).toEqual(['open', 'counting', 'counted', 'closed'])
    expect(ShiftSyncMode.options).toEqual(['central', 'local_only'])
    expect(OutboxStatus.options).toContain('closed_off_catalog')
    expect(EventType.options).toEqual(expect.arrayContaining(['CLOSED_OFF_CATALOG', 'DELIVERED_ELSEWHERE']))
  })
})
