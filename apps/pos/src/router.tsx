import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router'
import type { JSX } from 'react'
import { RequireSession } from './app/guards'
import { useSyncCycleSignal } from './app/useSyncCycleSignal'
import { BackupScreen } from './screens/BackupScreen'
import { CashPayScreen } from './screens/CashPayScreen'
import { CentralOrdersScreen } from './screens/CentralOrdersScreen'
import { CloseShiftScreen } from './screens/CloseShiftScreen'
import { DoneScreen } from './screens/DoneScreen'
import { IndexRedirect } from './screens/IndexRedirect'
import { LoginScreen } from './screens/LoginScreen'
import { OpenShiftScreen } from './screens/OpenShiftScreen'
import { OrderDetailScreen } from './screens/OrderDetailScreen'
import { OrdersScreen } from './screens/OrdersScreen'
import { OwnerRecoveryScreen } from './screens/OwnerRecoveryScreen'
import { PriceDiffScreen } from './screens/PriceDiffScreen'
import { QrPayScreen } from './screens/QrPayScreen'
import { SellScreen } from './screens/SellScreen'
import { SetupScreen } from './screens/SetupScreen'
import { ShiftScreen } from './screens/ShiftScreen'
import { StatusBanners } from './screens/StatusBanners'
import { SyncProblemsScreen } from './screens/SyncProblemsScreen'
import { SystemStatusScreen } from './screens/SystemStatusScreen'
import { ZListScreen } from './screens/ZListScreen'
import { ZReportScreen } from './screens/ZReportScreen'
import { BrandBar } from './ui/BrandBar'

// Root layout: the brand bar (D44), then every warning of spec §4.4 ข้อ 9 / §6.3 / §6.4 / §6.7 / §10.5 (Task 20,
// D80) on every screen after login, above whatever the route itself renders. Task 21 hotfix 2: the root also listens,
// once for the whole app, for the worker's "a sync cycle ran" signal and refetches the badge/banner data at once.
function RootLayout(): JSX.Element {
  useSyncCycleSignal()
  // One full-height column: the bar and banners take what they need, the route gets the rest and scrolls inside it,
  // so a banner appearing never pushes the sell screen's pay buttons below the fold.
  return (
    <div className="app-shell">
      <BrandBar />
      <StatusBanners />
      <div className="route">
        <Outlet />
      </div>
    </div>
  )
}
const rootRoute = createRootRoute({ component: RootLayout })

// Every path of plan 3 is declared here; each screen task adds `component` to its route.
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: IndexRedirect })
const setupRoute = createRoute({ getParentRoute: () => rootRoute, path: '/setup', component: SetupScreen })
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: LoginScreen })
// ruling N2: reached from the login screen's banner with nobody signed in yet — outside `<RequireSession>`.
const ownerRecoveryRoute = createRoute({ getParentRoute: () => rootRoute, path: '/owner-recovery', component: OwnerRecoveryScreen })
const openShiftRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/shift/open',
  component: () => (
    <RequireSession>
      <OpenShiftScreen />
    </RequireSession>
  ),
})
const sellRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sell',
  component: () => (
    <RequireSession>
      <SellScreen />
    </RequireSession>
  ),
})
const payCashRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pay/cash',
  component: () => (
    <RequireSession>
      <CashPayScreen />
    </RequireSession>
  ),
})
const payQrRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pay/qr',
  component: () => (
    <RequireSession>
      <QrPayScreen />
    </RequireSession>
  ),
})
const doneRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/done',
  validateSearch: (search: Record<string, unknown>): { orderId: string } => ({ orderId: typeof search['orderId'] === 'string' ? search['orderId'] : '' }),
  component: () => (
    <RequireSession>
      <DoneScreen />
    </RequireSession>
  ),
})
const ordersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/orders',
  component: () => (
    <RequireSession>
      <OrdersScreen />
    </RequireSession>
  ),
})
const orderDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/orders/$orderId',
  component: () => (
    <RequireSession>
      <OrderDetailScreen />
    </RequireSession>
  ),
})
// spec §4.6: today's bot/web bills, online only.
const centralOrdersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/central-orders',
  component: () => (
    <RequireSession>
      <CentralOrdersScreen />
    </RequireSession>
  ),
})
// spec §4.3, review item 23: owner-only "ยอดไม่ตรงระบบกลาง" (R11 — PriceDiffScreen checks `can(role,'price_diffs')` itself).
const priceDiffsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/price-diffs',
  component: () => (
    <RequireSession>
      <PriceDiffScreen />
    </RequireSession>
  ),
})

// Task 20: /status (every role) and /sync-problems (owner only — the screen itself redirects to /sell otherwise).
const statusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/status',
  component: () => (
    <RequireSession>
      <SystemStatusScreen />
    </RequireSession>
  ),
})
const syncProblemsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sync-problems',
  component: () => (
    <RequireSession>
      <SyncProblemsScreen />
    </RequireSession>
  ),
})

// แผน 3b: X report / close shift / Z / backup
const backupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/backup',
  component: () => (
    <RequireSession>
      <BackupScreen />
    </RequireSession>
  ),
})
const zListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/z',
  component: () => (
    <RequireSession>
      <ZListScreen />
    </RequireSession>
  ),
})
const zReportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/z/$shiftId',
  component: () => (
    <RequireSession>
      <ZReportScreen />
    </RequireSession>
  ),
})
const shiftRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/shift',
  component: () => (
    <RequireSession>
      <ShiftScreen />
    </RequireSession>
  ),
})
const closeShiftRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/shift/close',
  component: () => (
    <RequireSession>
      <CloseShiftScreen />
    </RequireSession>
  ),
})

// Task 16: the stock screens (แผน 4) are hidden from the routeTree — component files stay for a later task.
export const routeTree = rootRoute.addChildren([
  indexRoute,
  setupRoute,
  loginRoute,
  ownerRecoveryRoute,
  openShiftRoute,
  sellRoute,
  payCashRoute,
  payQrRoute,
  doneRoute,
  ordersRoute,
  orderDetailRoute,
  centralOrdersRoute,
  priceDiffsRoute,
  statusRoute,
  syncProblemsRoute,
  backupRoute,
  zListRoute,
  zReportRoute,
  shiftRoute,
  closeShiftRoute,
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
