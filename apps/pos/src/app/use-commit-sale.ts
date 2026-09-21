import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { posErrorCode } from '../api/errors'
import type { CommitSaleInput } from '../api/types'
import { cartReducer, cartTotals, toSaleLines, type CartAction } from '../state/cart'
import { useApi } from './api-context'
import { useCart } from './cart-context'
import { bootstrapKey, menuKey, ordersKey, shiftReportKey } from './queries'
import { useSession } from './session'

export type PriceChange = { fromSatang: number; toSatang: number }

/**
 * Pays the current cart. The cart's orderId makes a double tap safe (decision T17).
 * D50 Q3-27 (I-7): sends the total the customer was shown; on PRICE_CHANGED the cart is re-priced from a fresh menu
 * and `priceChange` tells the screen the old and new totals — the cashier checks them and presses confirm again.
 */
export function useCommitSale() {
  const api = useApi()
  const { state, dispatch, clear } = useCart()
  const { user } = useSession()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [priceChange, setPriceChange] = useState<PriceChange | null>(null)
  const pay = useMutation({
    mutationFn: (payment: CommitSaleInput['payment']) =>
      api.commitSale({
        orderId: state.orderId,
        actorUserId: user?.id ?? '',
        lines: toSaleLines(state),
        discount: state.discount,
        payment,
        expectedTotalSatang: cartTotals(state).totalSatang,
      }),
    onSuccess: async (result) => {
      setPriceChange(null)
      // Navigate first: clearing the cart while still on a pay screen would bounce back to /sell.
      await navigate({ to: '/done', search: { orderId: result.orderId } })
      clear()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: bootstrapKey }),
        queryClient.invalidateQueries({ queryKey: menuKey }),
        queryClient.invalidateQueries({ queryKey: ordersKey }),
        // review m-2: a committed sale changes expectedCashSatang (cash) or qrSalesSatang (QR); without this the X
        // report (and the Q3b-14 over-drawer check in CashMoveDialog) can read a stale figure for up to `staleTime`
        // (5s, main.tsx) after the sale.
        queryClient.invalidateQueries({ queryKey: shiftReportKey }),
      ])
    },
    onError: async (e) => {
      if (posErrorCode(e) !== 'PRICE_CHANGED') return
      const menu = await queryClient.fetchQuery({ queryKey: menuKey, queryFn: () => api.loadMenu(), staleTime: 0 })
      const reprice: CartAction = { type: 'reprice', prices: new Map(menu.variants.map((v) => [v.id, v.priceSatang])) }
      setPriceChange({ fromSatang: cartTotals(state).totalSatang, toSatang: cartTotals(cartReducer(state, reprice)).totalSatang })
      dispatch(reprice)
    },
  })
  return { pay, priceChange }
}
