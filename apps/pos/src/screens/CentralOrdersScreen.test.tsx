// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CentralOrderDto } from '../api/types'
import { renderWithApi, type FakeApi } from '../test-utils/render'
import { CentralOrdersScreen } from './CentralOrdersScreen'

afterEach(() => cleanup())

function renderCentral(over: FakeApi): void {
  renderWithApi(<CentralOrdersScreen />, { refreshDayoEdits: vi.fn(async () => ({ updated: 0 })), ...over })
}

describe('CentralOrdersScreen (spec §4.6)', () => {
  it('lists bot and web bills with the duplicate badge, and says so when offline', async () => {
    const rows: CentralOrderDto[] = [
      { orderNo: 'L260925-013', source: 'line', sourceLabel: 'บอท', createdByName: 'DCm', soldAt: '2026-09-25T03:10:00+00:00', totalSatang: 15_500, payment: 'cash', status: 'ok', duplicateSuspect: true },
    ]
    renderCentral({ listCentralOrdersToday: vi.fn(async () => rows) })
    expect(await screen.findByTestId('central-order-L260925-013')).toHaveTextContent('บอท · DCm · 10:10 · ฿155.00')
    expect(screen.getByTestId('central-order-L260925-013')).toHaveTextContent('อาจซ้ำ')
    cleanup()

    renderCentral({ listCentralOrdersToday: vi.fn(async () => { throw new Error('OFFLINE: network') }) })
    expect(await screen.findByText('ต้องออนไลน์เพื่อดูบิลจากบอท/เว็บ')).toBeInTheDocument()
  })

  it('refreshes dayo_edit display on open (spec §4.6)', async () => {
    const refreshDayoEdits = vi.fn(async () => ({ updated: 0 }))
    renderCentral({ listCentralOrdersToday: vi.fn(async () => []), refreshDayoEdits })
    await waitFor(() => expect(refreshDayoEdits).toHaveBeenCalled())
  })
})
