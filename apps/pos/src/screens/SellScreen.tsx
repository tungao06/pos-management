import { useQuery } from '@tanstack/react-query'
import { Navigate, useNavigate } from '@tanstack/react-router'
import { useState, type JSX } from 'react'
import type { MenuProduct } from '../api/types'
import { useApi } from '../app/api-context'
import { menuKey, useBootstrap } from '../app/queries'
import { useSession } from '../app/session'
import { isShiftStale } from '../lib/clock'
import { errorMessage } from '../ui/errors'
import { TH } from '../ui/th'
import { CartPanel } from './CartPanel'
import { CashMoveDialog } from './CashMoveDialog'
import { DiscountDialog } from './DiscountDialog'
import { ItemDialog } from './ItemDialog'

const BEST_TAB = '__best__'

export function SellScreen(): JSX.Element {
  const api = useApi()
  const boot = useBootstrap()
  const session = useSession()
  const navigate = useNavigate()
  const menuQuery = useQuery({ queryKey: menuKey, queryFn: () => api.loadMenu() })
  // I-5: warn when the browser has not granted persistent storage (spec §8/§12) — OPFS is the only copy until sync.
  const persisted = useQuery({ queryKey: ['storage-persisted'], queryFn: () => navigator.storage?.persisted?.() ?? Promise.resolve(false) })
  const [tab, setTab] = useState<string>(BEST_TAB)
  const [picking, setPicking] = useState<MenuProduct | null>(null)
  const [discountOpen, setDiscountOpen] = useState(false)
  const [cashMoveOpen, setCashMoveOpen] = useState(false)

  if (boot.data !== undefined && boot.data.openShift === null) return <Navigate to="/shift/open" />
  if (menuQuery.isPending) return <main className="page">{TH.loading}</main>
  if (menuQuery.isError) {
    return (
      <main className="page">
        <p role="alert" className="error">
          {errorMessage(menuQuery.error)}
        </p>
      </main>
    )
  }

  const menu = menuQuery.data
  const showBest = menu.bestSellerProductIds.length > 0 // hide the tab until something has sold (D48 Q3-9)
  const activeTab = tab === BEST_TAB && !showBest ? (menu.categories[0]?.id ?? '') : tab
  const products = activeTab === BEST_TAB ? menu.bestSellerProductIds.flatMap((id) => menu.products.filter((p) => p.id === id)) : menu.products.filter((p) => p.categoryId === activeTab)

  return (
    <div className="sell">
      <header className="topbar">
        {showBest && (
          <button type="button" data-testid="tab-best" aria-pressed={activeTab === BEST_TAB} onClick={() => setTab(BEST_TAB)}>
            {TH.tabBestSellers}
          </button>
        )}
        {menu.categories.map((c) => (
          <button key={c.id} type="button" data-testid={`tab-${c.code}`} aria-pressed={activeTab === c.id} onClick={() => setTab(c.id)}>
            {c.name}
          </button>
        ))}
        <span className="spacer" />
        {persisted.data === false && (
          <span className="error" data-testid="storage-not-persistent">
            {TH.storageNotPersistent}
          </span>
        )}
        <span className="badge" data-testid="pending-sync">
          {TH.pendingSync(boot.data?.pendingSyncItems ?? 0)}
        </span>
        <button type="button" data-testid="nav-orders" onClick={() => void navigate({ to: '/orders' })}>
          {TH.orders}
        </button>
        <button type="button" data-testid="cash-move-open" onClick={() => setCashMoveOpen(true)}>
          {TH.cashMove}
        </button>
        <button type="button" data-testid="nav-shift" onClick={() => void navigate({ to: '/shift' })}>
          {TH.shiftMenu}
        </button>
        <button type="button" data-testid="lock" onClick={session.lock}>
          {TH.lock}
        </button>
      </header>
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
      <main className="grid">
        {products.map((p) => (
          <button key={p.id} type="button" className="product" data-testid={`product-${p.code}`} onClick={() => setPicking(p)}>
            {/* Thai name large, English small (D48 Q3-11) */}
            <span className="th">{p.nameTh}</span>
            <span className="en">{p.nameEn}</span>
          </button>
        ))}
      </main>
      <CartPanel onOpenDiscount={() => setDiscountOpen(true)} onPay={(method) => void navigate({ to: method === 'CASH' ? '/pay/cash' : '/pay/qr' })} />
      {picking !== null && <ItemDialog menu={menu} product={picking} onClose={() => setPicking(null)} />}
      {discountOpen && <DiscountDialog onClose={() => setDiscountOpen(false)} />}
      {cashMoveOpen && <CashMoveDialog onClose={() => setCashMoveOpen(false)} />}
    </div>
  )
}
