import { createContext, useCallback, useContext, useMemo, useReducer, type Dispatch, type JSX, type ReactNode } from 'react'
import { newId } from '../lib/ids'
import { cartReducer, emptyCart, type CartAction, type CartState } from '../state/cart'

/** Placeholder until the catalog loads and `SellScreen` syncs it to `SellCatalogDto.defaultChannelCode` — never shown
 * to the cashier as a hardcoded size or price, only as the channel the cart starts on before a real catalog exists. */
const INITIAL_CHANNEL_CODE = 'store'

type CartContextValue = { state: CartState; dispatch: Dispatch<CartAction>; clear: () => void }
const CartContext = createContext<CartContextValue | null>(null)

export function CartProvider({ children, initial }: { children: ReactNode; initial?: CartState }): JSX.Element {
  const [state, dispatch] = useReducer(cartReducer, initial ?? null, (init: CartState | null) => init ?? emptyCart(newId(), INITIAL_CHANNEL_CODE))
  // Keeps the channel the cashier had selected — only the lines/discount/promo state of a bill start fresh (T17: a
  // new orderId makes the next sale independent of the one just paid or cleared).
  const clear = useCallback(() => dispatch({ type: 'reset', orderId: newId(), channelCode: state.channelCode }), [state.channelCode])
  const value = useMemo(() => ({ state, dispatch, clear }), [state, clear])
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const c = useContext(CartContext)
  if (c === null) throw new Error('useCart must be used inside <CartProvider>')
  return c
}
