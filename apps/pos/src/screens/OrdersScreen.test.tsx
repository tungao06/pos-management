// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OrderSummaryDto } from '../api/types'
import { renderWithApi, type FakeApi } from '../test-utils/render'
import { OrdersScreen } from './OrdersScreen'

afterEach(() => cleanup())

const CENTRAL_NONE = { state: 'legacy' as const, orderNo: null, computedTotalSatang: null, diffSatang: null, duplicateOf: [], reason: null, voidState: 'none' as const }

const ORDER: OrderSummaryDto = {
  id: 'o1',
  receiptNo: 'A-000001',
  queueNo: 1,
  status: 'paid',
  totalSatang: 4_500,
  method: 'CASH',
  paidAt: '2026-09-25T03:00:00Z',
  cups: 1,
  soldById: 'dcm',
  soldByName: 'DCm',
  central: CENTRAL_NONE,
  dayoEdit: null,
}

function renderOrders(over: FakeApi): void {
  renderWithApi(<OrdersScreen />, { listOrders: vi.fn(async () => [ORDER]), refreshDayoEdits: vi.fn(async () => ({ updated: 0 })), ...over })
}

describe('OrdersScreen — every bill says where and by whom (D61), and how dayo has it (§4.6)', () => {
  it('shows who sold each bill and its central-state chip', async () => {
    renderOrders({})
    const row = await screen.findByTestId('order-row-A-000001')
    expect(row).toHaveTextContent('แท็บเล็ต · DCm')
    expect(row.querySelector('[data-testid="central-state"]')).not.toBeNull()
  })

  it('shows the "แก้บนเว็บ" chip when dayo edited the bill', async () => {
    renderOrders({ listOrders: vi.fn(async () => [{ ...ORDER, dayoEdit: { kind: 'edit', editedAt: '2026-09-25T05:00:00Z', editedByName: null, reason: null, version: 1 } }]) })
    expect(await screen.findByTestId('order-dayo-edit-chip')).toHaveTextContent('แก้บนเว็บ')
  })

  it('shows the "ยกเลิกบนเว็บ" chip when dayo cancelled the bill', async () => {
    renderOrders({ listOrders: vi.fn(async () => [{ ...ORDER, dayoEdit: { kind: 'cancel', editedAt: '2026-09-25T05:00:00Z', editedByName: null, reason: null, version: 1 } }]) })
    expect(await screen.findByTestId('order-dayo-edit-chip')).toHaveTextContent('ยกเลิกบนเว็บ')
  })

  it('links to /central-orders', async () => {
    renderOrders({})
    expect(await screen.findByTestId('nav-central-orders')).toBeInTheDocument()
  })

  it('refreshes dayo_edit display on open (spec §4.6)', async () => {
    const refreshDayoEdits = vi.fn(async () => ({ updated: 0 }))
    renderOrders({ refreshDayoEdits })
    await waitFor(() => expect(refreshDayoEdits).toHaveBeenCalled())
  })
})
