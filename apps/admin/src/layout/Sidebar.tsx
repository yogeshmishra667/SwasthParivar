import type { ComponentType } from "react";
import { Link } from "@tanstack/react-router";
import type { AdminRole } from "@swasth/shared-types";
import {
  Activity,
  BarChart3,
  CreditCard,
  LayoutDashboard,
  ScrollText,
  ShieldCheck,
  ToggleLeft,
  Users,
} from "lucide-react";
import { useAdminRole } from "@/auth/auth-context";

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Roles allowed to see this nav item. Omit = visible to everyone signed in. */
  roles?: readonly AdminRole[];
}

const NAV: readonly NavItem[] = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/users", label: "Users", icon: Users },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/flags", label: "App Control", icon: ToggleLeft },
  { to: "/ops", label: "Ops", icon: Activity, roles: ["super_admin", "ops"] },
  { to: "/admins", label: "Admin Users", icon: ShieldCheck, roles: ["super_admin"] },
  { to: "/audit", label: "Audit log", icon: ScrollText, roles: ["super_admin", "ops"] },
  { to: "/billing", label: "Billing & Plans", icon: CreditCard },
];

const isVisible = (item: NavItem, role: AdminRole | null): boolean =>
  !item.roles || (role !== null && item.roles.includes(role));

export function Sidebar() {
  const role = useAdminRole();
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:flex">
      <div className="flex h-14 items-center border-b px-4">
        <span className="font-semibold tracking-tight">SwasthParivar</span>
        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          Admin
        </span>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {NAV.filter((item) => isVisible(item, role)).map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[status=active]:bg-accent data-[status=active]:text-foreground"
            activeOptions={{ exact: item.to === "/" }}
          >
            <item.icon className="h-4 w-4" />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
