import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router'
import { RequireSession } from './app/guards'
import { CashPayScreen } from './screens/CashPayScreen'
import { DoneScreen } from './screens/DoneScreen'
import { IndexRedirect } from './screens/IndexRedirect'
import { LoginScreen } from './screens/LoginScreen'
import { OpenShiftScreen } from './screens/OpenShiftScreen'
import { OrderDetailScreen } from './screens/OrderDetailScreen'
import { OrdersScreen } from './screens/OrdersScreen'
import { QrPayScreen } from './screens/QrPayScreen'
import { SellScreen } from './screens/SellScreen'
import { SetupScreen } from './screens/SetupScreen'
import { BrandBar } from './ui/BrandBar'

// Root layout: the brand bar (D44) above every screen.
const rootRoute = createRootRoute({
  component: () => (
    <>
      <BrandBar />
      <Outlet />
    </>
  ),
})

// Every path of plan 3 is declared here; each screen task adds `component` to its route.
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: IndexRedirect })
const setupRoute = createRoute({ getParentRoute: () => rootRoute, path: '/setup', component: SetupScreen })
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: LoginScreen })
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

export const routeTree = rootRoute.addChildren([
  indexRoute,
  setupRoute,
  loginRoute,
  openShiftRoute,
  sellRoute,
  payCashRoute,
  payQrRoute,
  doneRoute,
  ordersRoute,
  orderDetailRoute,
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
