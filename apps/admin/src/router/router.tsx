// Code-based TanStack Router route tree.
//
// All authenticated pages mount under one pathless layout route
// (`_app`) that renders `<AppLayout />`. AppLayout itself reads
// `useAuth()` and redirects to /login when status flips to
// `unauthenticated` — keeping the auth gate in React-land (rather
// than a router `beforeLoad`) avoids carrying the auth state on the
// router context, which simplifies the typing.

import { Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { AppLayout } from "@/layout/AppLayout";
import { LoginPage } from "@/pages/LoginPage";
import { OverviewPage } from "@/pages/OverviewPage";
import { UsersPage } from "@/pages/UsersPage";
import { UserDetailPage } from "@/pages/UserDetailPage";
import { AnalyticsPage } from "@/pages/AnalyticsPage";
import { FlagsPage } from "@/pages/FlagsPage";
import { OpsPage } from "@/pages/OpsPage";
import { AdminsPage } from "@/pages/AdminsPage";
import { AuditPage } from "@/pages/AuditPage";
import { BillingPage } from "@/pages/BillingPage";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_app",
  component: AppLayout,
});

const overviewRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/",
  component: OverviewPage,
});
const usersRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/users",
  component: UsersPage,
});
export const userDetailRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/users/$id",
  component: UserDetailPage,
});
const analyticsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/analytics",
  component: AnalyticsPage,
});
const flagsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/flags",
  component: FlagsPage,
});
const opsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/ops",
  component: OpsPage,
});
const adminsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/admins",
  component: AdminsPage,
});
const auditRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/audit",
  component: AuditPage,
});
const billingRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/billing",
  component: BillingPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appLayoutRoute.addChildren([
    overviewRoute,
    usersRoute,
    userDetailRoute,
    analyticsRoute,
    flagsRoute,
    opsRoute,
    adminsRoute,
    auditRoute,
    billingRoute,
  ]),
]);

export const router = createRouter({ routeTree });

// Register the router so `<Link to="…">` and `useNavigate({ to: "…" })`
// are type-checked against the path literals above.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
