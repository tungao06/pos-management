import { useQuery } from '@tanstack/react-query'
import { Navigate, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState, type JSX } from 'react'
import { menuUnitPriceSatang } from '@dayo/domain'
import type { SellMenuDto } from '../api/types'
import { useApi } from '../app/api-context'
import { useCart } from '../app/cart-context'
import { sellCatalogKey, useBootstrap } from '../app/queries'
import { useSession } from '../app/session'
import { isShiftStale } from '../lib/clock'
import { errorMessage } from '../ui/errors'
import { formatBaht } from '../ui/format'
import { TH } from '../ui/th'
import { CartPanel } from './CartPanel'
import { CashMoveDialog } from './CashMoveDialog'
import { DiscountDialog } from './DiscountDialog'
import { ItemDialog } from './ItemDialog'

const BEST_TAB = '__best__'
/** Every menu, across categories — the tab shown (and selected) until the cashier picks a category or "ขายดี". */
const ALL_TAB = '__all__'
/** spec §6.5: dayo's menu/price/promotion changes reach the tablet without restarting it — refetched on this timer. */
const CATALOG_REFETCH_MS = 60_000

export function SellScreen(): JSX.Element {
  const api = useApi()
  const boot = useBootstrap()
  const session = useSession()
  const navigate = useNavigate()
  const { state: cart, dispatch } = useCart()
  const catalogQuery = useQuery({ queryKey: sellCatalogKey, queryFn: () => api.loadSellCatalog(), refetchInterval: CATALOG_REFETCH_MS })
  // I-5: warn when the browser has not granted persistent storage (spec §8/§12) — OPFS is the only copy until sync.
  const persisted = useQuery({ queryKey: ['storage-persisted'], queryFn: () => navigator.storage?.persisted?.() ?? Promise.resolve(false) })
  const [tab, setTab] = useState<string>(ALL_TAB)
  const [picking, setPicking] = useState<SellMenuDto | null>(null)
  const [discountOpen, setDiscountOpen] = useState(false)
  const [cashMoveOpen, setCashMoveOpen] = useState(false)

  // spec §6.5: catalogVersion changed while the cart was open — the cart is already priced with the new catalog
  // (usePricedCart, inside CartPanel), this only tells the cashier so.
  const seenVersion = useRef<number | null>(null)
  const [catalogChanged, setCatalogChanged] = useState(false)
  useEffect(() => {
    const version = catalogQuery.data?.catalogVersion
    if (version === undefined) return
    if (seenVersion.current !== null && seenVersion.current !== version) setCatalogChanged(true)
    seenVersion.current = version
  }, [catalogQuery.data?.catalogVersion])

  // Starts the cart on dayo's own default channel (never a hardcoded one) — only while the cart is still empty, so
  // switching channel mid-sale is always the cashier's own choice.
  useEffect(() => {
    const dto = catalogQuery.data
    if (dto !== undefined && cart.lines.length === 0 && cart.channelCode !== dto.defaultChannelCode) {
      dispatch({ type: 'setChannel', channelCode: dto.defaultChannelCode })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogQuery.data?.defaultChannelCode])

  if (boot.data !== undefined && boot.data.openShift === null) return <Navigate to="/shift/open" />
  if (catalogQuery.isPending) return <main className="page">{TH.loading}</main>
  if (catalogQuery.isError) {
    return (
      <main className="page">
        <p role="alert" className="error">
          {errorMessage(catalogQuery.error)}
        </p>
      </main>
    )
  }

  const dto = catalogQuery.data
  const showBest = dto.bestSellerCodes.length > 0 // hide the tab until something has sold (D48 Q3-9)
  const activeTab = tab === BEST_TAB && !showBest ? ALL_TAB : tab
  const menus =
    activeTab === ALL_TAB
      ? dto.menus
      : activeTab === BEST_TAB
        ? dto.bestSellerCodes.flatMap((code) => dto.menus.filter((m) => m.code === code))
        : dto.menus.filter((m) => m.categoryLabel === activeTab)

  return (
    <div className="sell">
      <header className="topbar">
        <div className="tabs">
          <button type="button" data-testid="tab-all" aria-pressed={activeTab === ALL_TAB} onClick={() => setTab(ALL_TAB)}>
            {TH.tabAll}
          </button>
          {showBest && (
            <button type="button" data-testid="tab-best" aria-pressed={activeTab === BEST_TAB} onClick={() => setTab(BEST_TAB)}>
              {TH.tabBestSellers}
            </button>
          )}
          {dto.categories.map((c) => (
            <button key={c} type="button" data-testid={`tab-${c}`} aria-pressed={activeTab === c} onClick={() => setTab(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="nav">
          <button type="button" data-testid="nav-orders" onClick={() => void navigate({ to: '/orders' })}>
            {TH.orders}
          </button>
          <button type="button" data-testid="cash-move-open" onClick={() => setCashMoveOpen(true)}>
            {TH.cashMove}
          </button>
          <button type="button" data-testid="nav-shift" onClick={() => void navigate({ to: '/shift' })}>
            {TH.shiftMenu}
          </button>
          {/* Q3b-3 · D52 (review I-2): closing starts here, not from the X report, so the drawer is counted blind */}
          <button type="button" data-testid="close-shift-open" onClick={() => void navigate({ to: '/shift/close' })}>
            {TH.closeShift}
          </button>
          <button type="button" data-testid="lock" onClick={session.lock}>
            {TH.lock}
          </button>
        </div>
      </header>
      <div className="sell-alerts">
        {persisted.data === false && (
          <p className="error" data-testid="storage-not-persistent">
            {TH.storageNotPersistent}
          </p>
        )}
        {boot.data?.openShift != null && isShiftStale(boot.data.openShift.businessDate, new Date().toISOString()) && (
          <p role="alert" className="error" data-testid="shift-stale">
            {TH.shiftStale(boot.data.openShift.businessDate)}
          </p>
        )}
        {boot.data?.backupDue === true && (
          <button type="button" role="alert" className="error" data-testid="backup-due" onClick={() => void navigate({ to: '/backup' })}>
            {TH.backupDue}
          </button>
        )}
        {catalogChanged && (
          <button type="button" role="alert" className="error" data-testid="catalog-changed" onClick={() => setCatalogChanged(false)}>
            {TH.catalogChanged}
          </button>
        )}
      </div>
      <main className="grid">
        {menus.map((m) => {
          const variant = dto.catalog.variants.find((v) => v.menuCode === m.code && v.size === m.defaultSize && v.sweetness === m.defaultSweetness)
          const price = variant === undefined ? null : menuUnitPriceSatang(dto.catalog, variant, cart.channelCode)
          return (
            <button key={m.code} type="button" className="product" data-testid={`menu-${m.code}`} onClick={() => setPicking(m)}>
              <span className="th">{m.nameTh}</span>
              <span className="price">{price === null ? TH.noPrice : formatBaht(price)}</span>
            </button>
          )
        })}
      </main>
      <CartPanel
        catalog={dto.catalog}
        channels={dto.channels}
        payments={dto.payments}
        maxQtyPerLine={dto.maxQtyPerLine}
        onOpenDiscount={() => setDiscountOpen(true)}
        onPay={(method) => void navigate({ to: method === 'CASH' ? '/pay/cash' : '/pay/qr' })}
      />
      {picking !== null && (
        <ItemDialog catalog={dto.catalog} menu={picking} channelCode={cart.channelCode} maxQtyPerLine={dto.maxQtyPerLine} onClose={() => setPicking(null)} />
      )}
      {discountOpen && <DiscountDialog catalog={dto.catalog} onClose={() => setDiscountOpen(false)} />}
      {cashMoveOpen && <CashMoveDialog onClose={() => setCashMoveOpen(false)} />}
    </div>
  )
}
