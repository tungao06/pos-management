import { zeroTotalVerdict, type PricedCart, type ZeroTotalVerdict } from '@dayo/domain'
import { toCartDraft, type CartState } from '../state/cart'

/**
 * D124 · owner Q1 = ข: whether the bill may be sold at ฿0 — the domain's own verdict (`zeroTotalVerdict`), asked as if
 * the customer pays cash (a ฿0 bill can only be paid in cash — the QR screen and button are refused separately).
 * 'ok' on any bill above ฿0. Never a total computed here.
 */
export function zeroVerdictOf(state: CartState, priced: PricedCart | null): ZeroTotalVerdict {
  if (priced === null) return 'ok'
  return zeroTotalVerdict({ ...toCartDraft(state), paymentCode: 'cash' }, priced)
}
