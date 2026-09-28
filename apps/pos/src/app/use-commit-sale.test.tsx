// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { JSX, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { PosApi, RecordSaleResult } from '../api/types'
import { testSellCatalog } from '../test-utils/sell-catalog'
import { ApiProvider } from './api-context'
import { CartProvider } from './cart-context'
import { shiftReportKey, stockKey } from './queries'
import { SessionProvider } from './session'
import { useCommitSale } from './use-commit-sale'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}))

const RESULT: RecordSaleResult = { orderId: 'o1', receiptNo: 'A-000001', queueNo: 1, businessDate: '2026-09-25', totalSatang: 7_500, changeSatang: null, method: 'PROMPTPAY' }

function withApi(overrides: Partial<PosApi>, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  const api = { loadSellCatalog: async () => testSellCatalog(), ...overrides } as unknown as PosApi
  return {
    queryClient,
    wrapper: ({ children }: { children: ReactNode }): JSX.Element => (
      <QueryClientProvider client={queryClient}>
        <ApiProvider api={api}>
          <SessionProvider>
            <CartProvider>{children}</CartProvider>
          </SessionProvider>
        </ApiProvider>
      </QueryClientProvider>
    ),
  }
}

describe('useCommitSale — PRICE_CHANGED (D50 Q3-27)', () => {
  it('keeps the sale unpaid and shows old → new until the cashier confirms (D50 Q3-27)', async () => {
    const recordSale = vi.fn().mockRejectedValueOnce(new Error('PRICE_CHANGED: shown 7000, now 7500')).mockResolvedValueOnce(RESULT)
    const { wrapper } = withApi({ recordSale })
    const { result } = renderHook(() => useCommitSale(), { wrapper })

    await act(() => result.current.pay({ method: 'PROMPTPAY' }, 7_000))
    expect(result.current.priceChanged).toEqual({ shownSatang: 7_000, nowSatang: 7_500 })
    expect(recordSale).toHaveBeenCalledTimes(1)

    await act(() => result.current.confirmPriceChange())
    expect(recordSale).toHaveBeenLastCalledWith(expect.objectContaining({ expectedTotalSatang: 7_500 }))
    expect(recordSale).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(result.current.priceChanged).toBeNull())
  })
})

describe('useCommitSale — review m-2 (carried): the shift-report cache must be invalidated after a recorded sale', () => {
  it('invalidates shiftReportKey and stockKey on success', async () => {
    const recordSale = vi.fn(async (): Promise<RecordSaleResult> => RESULT)
    const { wrapper, queryClient } = withApi({ recordSale })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useCommitSale(), { wrapper })

    await act(() => result.current.pay({ method: 'PROMPTPAY' }, 7_500))

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: shiftReportKey })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: stockKey })
  })
})

describe('useCommitSale — an ordinary error (not PRICE_CHANGED)', () => {
  it('surfaces through isError/error and leaves priceChanged null', async () => {
    const recordSale = vi.fn().mockRejectedValueOnce(new Error('TENDER_TOO_LOW: tendered 100 < total 200'))
    const { wrapper } = withApi({ recordSale })
    const { result } = renderHook(() => useCommitSale(), { wrapper })

    await act(() => result.current.pay({ method: 'CASH', tenderedSatang: 100 }, 200))
    expect(result.current.priceChanged).toBeNull()
    expect(result.current.isError).toBe(true)
  })
})
