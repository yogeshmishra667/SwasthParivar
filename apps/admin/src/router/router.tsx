// Code-based TanStack Router route tree.
//
// All authenticated pages mount under one pathless layout route
// (`_app`) that renders `<AppLayout />`. AppLayout itself reads
// `useAuth()` and redirects to /login when status flips to
// `unauthenticated` — keeping the auth gate in React-land (rather
// than a router `beforeLoad`) avoids carrying the auth state on the
// router context, which simplifies the typing.
//
// Every page component is `React.lazy`-loaded so the initial bundle
// only carries the providers + router + AppLayout/Sidebar/Topbar +
// shared primitives. Each page becomes its own chunk that loads on
// first navigation; subsequent visits hit the browser cache. The
// `<Suspense>` at the root handles the very first load; AppLayout
// owns a tighter Suspense around its `<Outlet>` so navigating between
// already-authenticated pages keeps the sidebar/topbar visible while
// the new page chunk streams in (see AppLayout.tsx).

import { lazy, Suspense } from "react";
import { Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { AppLayout } from "@/layout/AppLayout";
import { Skeleton } from "@/components/ui/skeleton";

// Bridge from named exports (the workspace style) to React.lazy's
// default-export contract. Tiny helper kept inline rather than in a
// shared util — it's the only file that needs it.
const lazyPage = <K extends string>(
  loader: () => Promise<Record<K, React.ComponentType>>,
  name: K,
) =>
  lazy(async () => {
    const mod = await loader();
    return { default: mod[name] };
  });

const LoginPage = lazyPage(() => import("@/pages/LoginPage"), "LoginPage");
const OverviewPage = lazyPage(() => import("@/pages/OverviewPage"), "OverviewPage");
const UsersPage = lazyPage(() => import("@/pages/UsersPage"), "UsersPage");
const UserDetailPage = lazyPage(() => import("@/pages/UserDetailPage"), "UserDetailPage");
const AnalyticsPage = lazyPage(() => import("@/pages/AnalyticsPage"), "AnalyticsPage");
const FlagsPage = lazyPage(() => import("@/pages/FlagsPage"), "FlagsPage");
const OpsPage = lazyPage(() => import("@/pages/OpsPage"), "OpsPage");
const AdminsPage = lazyPage(() => import("@/pages/AdminsPage"), "AdminsPage");
const AuditPage = lazyPage(() => import("@/pages/AuditPage"), "AuditPage");
const BillingPage = lazyPage(() => import("@/pages/BillingPage"), "BillingPage");

/**
 * First-paint fallback for the outermost Suspense — shown only on the
 * very first load (the layout's own Suspense takes over once
 * AppLayout has mounted). Deliberately minimal so it doesn't flash
 * a richer skeleton than the page that's about to render.
 */
function InitialLoading() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <Skeleton className="h-32 w-full max-w-2xl" />
    </div>
  );
}

const rootRoute = createRootRoute({
  component: () => (
    <Suspense fallback={<InitialLoading />}>
      <Outlet />
    </Suspense>
  ),
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
