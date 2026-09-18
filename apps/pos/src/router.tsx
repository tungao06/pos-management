import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router'
import { IndexRedirect } from './screens/IndexRedirect'
import { LoginScreen } from './screens/LoginScreen'
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
const openShiftRoute = createRoute({ getParentRoute: () => rootRoute, path: '/shift/open' })
const sellRoute = createRoute({ getParentRoute: () => rootRoute, path: '/sell' })
const payCashRoute = createRoute({ getParentRoute: () => rootRoute, path: '/pay/cash' })
const payQrRoute = createRoute({ getParentRoute: () => rootRoute, path: '/pay/qr' })
const doneRoute = createRoute({ getParentRoute: () => rootRoute, path: '/done' })
const ordersRoute = createRoute({ getParentRoute: () => rootRoute, path: '/orders' })
const orderDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: '/orders/$orderId' })

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
