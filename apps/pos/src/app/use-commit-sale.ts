import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { posErrorCode } from '../api/errors'
import type { RecordSaleInput } from '../api/types'
import { toCartDraft } from '../state/cart'
import { useApi } from './api-context'
import { useCart } from './cart-context'
import { bootstrapKey, ordersKey, sellCatalogKey, shiftReportKey, stockKey, syncStatusKey } from './queries'
import { useSession } from './session'

export type PriceChanged = { shownSatang: number; nowSatang: number }

/**
 * Pays the current cart with dayo's catalog (`recordSale`, spec 04 §4.5, §5.1). The cart's `orderId` makes a double
 * tap safe (decision T17). D50 Q3-27 (I-7): sends the total the customer was shown; PRICE_CHANGED never auto-retries
 * — it exposes `priceChanged` (old → new, parsed from the error detail) and `confirmPriceChange()` resends the same
 * payment with the new total once the cashier checks it and presses confirm again.
 */
export function useCommitSale() {
  const api = useApi()
  const { state, clear } = useCart()
  const { user } = useSession()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [priceChanged, setPriceChanged] = useState<PriceChanged | null>(null)
  const [lastPayment, setLastPayment] = useState<RecordSaleInput['payment'] | null>(null)
  // review round 2, item 1: forces `usePricedCart` to recompute right away — react-query's structural sharing can
  // hand back the same `catalog` reference after a refetch when only the wall clock (a promotion's time window),
  // not the catalog's own data, moved the price; the 30 s timer alone would leave the screen stale until then.
  const [priceBump, setPriceBump] = useState(0)

  const mutation = useMutation({
    mutationFn: (input: { payment: RecordSaleInput['payment']; expectedTotalSatang: number }) =>
      api.recordSale({ orderId: state.orderId, actorUserId: user?.id ?? '', cart: toCartDraft(state), payment: input.payment, expectedTotalSatang: input.expectedTotalSatang }),
    onSuccess: async (result) => {
      // Navigate first: clearing the cart while still on a pay screen would bounce back to /sell.
      await navigate({ to: '/done', search: { orderId: result.orderId } })
      clear()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: bootstrapKey }),
        // fix (Task 17): StatusBanners's badge-pending/banner-problems now read `syncStatus()`'s own cached answer
        // once it has one (fix round 2 item E) — invalidating bootstrapKey alone left them stale right after a sale.
        queryClient.invalidateQueries({ queryKey: syncStatusKey }),
        queryClient.invalidateQueries({ queryKey: sellCatalogKey }),
        queryClient.invalidateQueries({ queryKey: ordersKey }),
        // review m-2 (carried): a committed sale changes expectedCashSatang (cash) or qrSalesSatang (QR); without
        // this the X report (and the Q3b-14 over-drawer check in CashMoveDialog) can read a stale figure for up to
        // `staleTime` (5s, main.tsx) after the sale.
        queryClient.invalidateQueries({ queryKey: shiftReportKey }),
        // plan 4 (carried): a sale moves stock — the sell-screen badge and the stock page must not show old figures
        queryClient.invalidateQueries({ queryKey: stockKey }),
      ])
    },
  })

  /**
   * Sends the cart; never throws — a PRICE_CHANGED lands in `priceChanged`, anything else in `pay.isError`/`pay.error`
   * (review I3: any OTHER error clears a stale `priceChanged` first, so the screen shows the new error, not a frozen
   * "price changed" banner from an earlier attempt). Review C1: the fresh catalog is fetched — with `refetchQueries`,
   * not just invalidated — BEFORE `priceChanged` is set, so `usePricedCart` (fed the caller's own `catalog` query) has
   * already re-priced the cart to the new total by the time the screen re-renders; the cash/QR total, the change and
   * the PromptPay payload (keyed on that total) are never stale.
   */
  const pay = async (payment: RecordSaleInput['payment'], expectedTotalSatang: number): Promise<void> => {
    setLastPayment(payment)
    try {
      await mutation.mutateAsync({ payment, expectedTotalSatang })
      setPriceChanged(null)
    } catch (e) {
      if (posErrorCode(e) !== 'PRICE_CHANGED') {
        setPriceChanged(null)
        return
      }
      await queryClient.refetchQueries({ queryKey: sellCatalogKey })
      setPriceBump((b) => b + 1)
      const raw = e instanceof Error ? e.message : ''
      const m = /shown (\d+), now (\d+)/.exec(raw)
      setPriceChanged({ shownSatang: expectedTotalSatang, nowSatang: m ? Number(m[2]) : expectedTotalSatang })
    }
  }

  const confirmPriceChange = async (): Promise<void> => {
    if (priceChanged === null || lastPayment === null) return
    await pay(lastPayment, priceChanged.nowSatang)
  }

  return { pay, priceChanged, confirmPriceChange, priceBump, isPending: mutation.isPending, isSuccess: mutation.isSuccess, isError: mutation.isError && priceChanged === null, error: mutation.error }
}
