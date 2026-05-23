import { LogOut, MonitorSmartphone, Moon, Sun } from "lucide-react";
import { useAuth } from "@/auth/auth-context";
import { useTheme, type Theme } from "@/theme/ThemeProvider";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const computeInitials = (name: string | undefined): string => {
  if (!name) return "—";
  return name
    .split(" ")
    .map((p) => p.charAt(0))
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
};

export function Topbar() {
  const { admin, signOut } = useAuth();
  const { theme, resolved, setTheme } = useTheme();
  const initials = computeInitials(admin?.name);

  const themes: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: MonitorSmartphone },
  ];

  return (
    <header className="flex h-14 items-center justify-end gap-2 border-b bg-background px-4">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Toggle theme">
            {resolved === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {themes.map((t) => (
            <DropdownMenuItem
              key={t.value}
              onClick={() => {
                setTheme(t.value);
              }}
            >
              <t.icon className="h-4 w-4" />
              <span>{t.label}</span>
              {theme === t.value ? (
                <span className="ml-auto text-xs text-muted-foreground">·</span>
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-8 gap-2 px-2">
            <Avatar className="h-6 w-6">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <span className="text-sm">{admin?.name ?? "—"}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[14rem]">
          <DropdownMenuLabel className="space-y-0.5">
            <div className="text-sm font-medium">{admin?.name ?? "—"}</div>
            <div className="text-xs font-normal text-muted-foreground">{admin?.email ?? ""}</div>
            <div className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
              {admin?.role ?? ""}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              void signOut();
            }}
          >
            <LogOut className="h-4 w-4" />
            <span>Sign out</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
