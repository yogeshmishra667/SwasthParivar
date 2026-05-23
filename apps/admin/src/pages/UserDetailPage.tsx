import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowLeft, Lock, Phone, User as UserIcon } from "lucide-react";
import type { AdminPatientListItem, AdminResourcePanelMeta, AdminTier } from "@swasth/shared-types";
import { useChangeUserTier, useUser, useUserResource } from "@/api/queries";
import { humanizeApiError } from "@/lib/errorMessage";
import { cn } from "@/lib/cn";
import { userDetailRoute } from "@/router/router";
import { renderUserPanel } from "@/registry/userPanelRegistry";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { JsonViewer } from "@/components/shared/JsonViewer";
import { RoleGate } from "@/components/shared/RoleGate";

// ── Helpers ──────────────────────────────────────────────────────

const TIERS: readonly AdminTier[] = ["free", "premium", "family"];

const computeInitials = (name: string): string =>
  name
    .split(" ")
    .map((p) => p.charAt(0))
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

// ── Tier change ──────────────────────────────────────────────────

interface TierChangeProps {
  userId: string;
  currentTier: AdminTier;
}

function TierChange({ userId, currentTier }: TierChangeProps) {
  const [next, setNext] = useState<AdminTier>(currentTier);
  const [confirming, setConfirming] = useState(false);
  const mutation = useChangeUserTier(userId);

  const dirty = next !== currentTier;

  return (
    <div className="flex items-center gap-2">
      <Select
        value={next}
        onValueChange={(v) => {
          setNext(v as AdminTier);
        }}
      >
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TIERS.map((t) => (
            <SelectItem key={t} value={t}>
              {t}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant="outline"
        disabled={!dirty || mutation.isPending}
        onClick={() => {
          setConfirming(true);
        }}
      >
        {mutation.isPending ? "Saving…" : "Change tier"}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Change tier to ${next}?`}
        description={`This is audit-logged. The user's tier moves from "${currentTier}" to "${next}" immediately.`}
        confirmLabel="Yes, change tier"
        onConfirm={async () => {
          await mutation.mutateAsync(next);
        }}
      />
    </div>
  );
}

// ── Resource panels ──────────────────────────────────────────────

interface PanelViewProps {
  userId: string;
  panel: AdminResourcePanelMeta;
}

function PanelView({ userId, panel }: PanelViewProps) {
  const { data, isLoading, isError, error } = useUserResource(userId, panel.key);

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Couldn't load {panel.label}</AlertTitle>
        <AlertDescription>{humanizeApiError(error)}</AlertDescription>
      </Alert>
    );
  }
  if (!data) return null;
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{panel.label}</h3>
        <p className="text-xs text-muted-foreground">{panel.description}</p>
      </div>
      {renderUserPanel(data)}
    </div>
  );
}

interface PanelNavProps {
  panels: readonly AdminResourcePanelMeta[];
  active: string | null;
  onSelect: (key: string) => void;
}

function PanelNav({ panels, active, onSelect }: PanelNavProps) {
  return (
    <nav className="space-y-1">
      {panels.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => {
            onSelect(p.key);
          }}
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-foreground",
            active === p.key ? "bg-accent text-foreground" : "text-muted-foreground",
          )}
        >
          <span className="truncate">{p.label}</span>
          {p.sensitive ? (
            <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Sensitive" />
          ) : null}
        </button>
      ))}
    </nav>
  );
}

// ── Sub-cards ────────────────────────────────────────────────────

interface CoProfilesCardProps {
  profiles: readonly AdminPatientListItem[];
}

function CoProfilesCard({ profiles }: CoProfilesCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Co-profiles in household</CardTitle>
        <CardDescription className="text-xs">
          Other patients sharing this household ID.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {profiles.map((p) => (
          <Link
            key={p.id}
            to="/users/$id"
            params={{ id: p.id }}
            className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
          >
            <span className="truncate">{p.name}</span>
            <Badge variant="outline" className="shrink-0">
              {p.tier}
            </Badge>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────

export function UserDetailPage() {
  const { id } = userDetailRoute.useParams();
  const { data, isLoading, isError, error } = useUser(id);
  const [activePanel, setActivePanel] = useState<string | null>(null);

  // Memoise so `panels` is referentially stable while `data` is — keeps
  // the effective-active useMemo below from churning every render.
  const panels = useMemo(() => data?.panels ?? [], [data?.panels]);

  // Default to the first panel once data loads.
  const effectiveActive: string | null = useMemo(() => {
    if (activePanel && panels.some((p) => p.key === activePanel)) return activePanel;
    return panels[0]?.key ?? null;
  }, [activePanel, panels]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="space-y-4">
        <Link
          to="/users"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to users
        </Link>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Couldn't load user</AlertTitle>
          <AlertDescription>{humanizeApiError(error, "User not found.")}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { user, coProfiles, streak, notificationState } = data;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/users"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to users
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <Avatar className="h-12 w-12">
            <AvatarFallback>{computeInitials(user.name)}</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold leading-tight">{user.name}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3.5 w-3.5" /> {user.phone}
              </span>
              <span>·</span>
              <span>age {user.age}</span>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <UserIcon className="h-3.5 w-3.5" /> {user.gender ?? "—"}
              </span>
              <span>·</span>
              <Badge variant="outline">{user.tier}</Badge>
              {user.conditions.map((c) => (
                <Badge key={c} variant="secondary">
                  {c}
                </Badge>
              ))}
            </div>
          </div>
          <RoleGate allow={["super_admin", "ops"]}>
            <TierChange userId={user.id} currentTier={user.tier} />
          </RoleGate>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs">
              <DetailRow label="Language" value={user.preferredLanguage} />
              <DetailRow label="Timezone" value={user.timezone} />
              <DetailRow
                label="Onboarding"
                value={user.onboardingComplete ? "Complete" : `Step ${String(user.onboardingStep)}`}
              />
              <DetailRow label="Household" value={user.householdId} mono />
              <DetailRow label="Time anomalies" value={String(user.timeAnomalyCount)} />
              <DetailRow label="Created" value={new Date(user.createdAt).toLocaleDateString()} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Streak</CardTitle>
            </CardHeader>
            <CardContent>
              {streak ? (
                <JsonViewer value={streak} className="max-h-48" />
              ) : (
                <p className="text-xs text-muted-foreground">
                  No streak record — user has never logged.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Notification state</CardTitle>
            </CardHeader>
            <CardContent>
              {notificationState ? (
                <JsonViewer value={notificationState} className="max-h-48" />
              ) : (
                <p className="text-xs text-muted-foreground">No notification state recorded yet.</p>
              )}
            </CardContent>
          </Card>

          {coProfiles.length > 0 ? <CoProfilesCard profiles={coProfiles} /> : null}
        </div>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Resource panels</CardTitle>
            <CardDescription className="text-xs">
              Sensitive panels (
              <Lock className="inline h-3 w-3" />) write a <code>patient_data_viewed</code> audit
              row when opened.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-[180px_1fr]">
              <PanelNav panels={panels} active={effectiveActive} onSelect={setActivePanel} />
              <div className="min-h-32">
                {effectiveActive ? (
                  <PanelView
                    userId={user.id}
                    panel={panels.find((p) => p.key === effectiveActive)!}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">No panels registered.</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Tiny presentational helper ───────────────────────────────────

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("text-right", mono && "font-mono text-[11px]")}>{value}</span>
    </div>
  );
}
