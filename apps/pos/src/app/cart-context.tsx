import { createContext, useCallback, useContext, useMemo, useReducer, type Dispatch, type JSX, type ReactNode } from 'react'
import { newId } from '../lib/ids'
import { cartReducer, emptyCart, type CartAction, type CartState } from '../state/cart'

type CartContextValue = { state: CartState; dispatch: Dispatch<CartAction>; clear: () => void }
const CartContext = createContext<CartContextValue | null>(null)

export function CartProvider({ children, initial }: { children: ReactNode; initial?: CartState }): JSX.Element {
  const [state, dispatch] = useReducer(cartReducer, initial ?? null, (init: CartState | null) => init ?? emptyCart(newId()))
  const clear = useCallback(() => dispatch({ type: 'reset', orderId: newId() }), [])
  const value = useMemo(() => ({ state, dispatch, clear }), [state, clear])
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const c = useContext(CartContext)
  if (c === null) throw new Error('useCart must be used inside <CartProvider>')
  return c
}
