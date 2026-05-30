import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Activity, Database, ServerCog, Gauge } from "lucide-react";
import { useFlag, useSetFlag, useOpsHealth, useOpsQueues, useSetMaintenance } from "@/api/queries";
import { getAccessToken } from "@/api/client";
import { humanizeApiError } from "@/lib/errorMessage";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const MAINTENANCE_FLAG = "maintenance_mode";

function HealthCards() {
  const { data, isLoading, isError, error } = useOpsHealth();

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Probe failed</AlertTitle>
        <AlertDescription>{humanizeApiError(error)}</AlertDescription>
      </Alert>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm">Database</CardTitle>
          </div>
          <Badge variant={data.checks.db === "ok" ? "success" : "destructive"}>
            {data.checks.db === "ok" ? "ok" : "down"}
          </Badge>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">pinged</CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div className="flex items-center gap-2">
            <ServerCog className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm">Redis</CardTitle>
          </div>
          <Badge variant={data.checks.redis === "ok" ? "success" : "destructive"}>
            {data.checks.redis === "ok" ? "ok" : "down"}
          </Badge>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">pinged</CardContent>
      </Card>
    </div>
  );
}

function QueuesCard() {
  const { data, isLoading, isError, error } = useOpsQueues();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm">BullMQ queues</CardTitle>
        </div>
        <CardDescription className="text-xs">Auto-refreshes every 10 seconds.</CardDescription>
      </CardHeader>
      <CardContent>
        {isError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Couldn't read queue stats</AlertTitle>
            <AlertDescription>{humanizeApiError(error)}</AlertDescription>
          </Alert>
        ) : isLoading || !data ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Queue</TableHead>
                <TableHead className="text-right">Waiting</TableHead>
                <TableHead className="text-right">Active</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead className="text-right">Delayed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.queues.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No queues registered.
                  </TableCell>
                </TableRow>
              ) : (
                data.queues.map((q) => (
                  <TableRow key={q.name}>
                    <TableCell className="font-mono text-xs">{q.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{q.waiting}</TableCell>
                    <TableCell className="text-right tabular-nums">{q.active}</TableCell>
                    <TableCell className="text-right tabular-nums">{q.completed}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {q.failed > 0 ? (
                        <span className="font-medium text-destructive">{q.failed}</span>
                      ) : (
                        q.failed
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{q.delayed}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
        <div className="mt-4 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const token = getAccessToken();
              window.open(
                `${import.meta.env.VITE_API_BASE_URL ?? ""}/admin/queues?token=${token}`,
                "_blank",
              );
            }}
          >
            Open Detailed Queue Dashboard ↗
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MaintenanceToggle() {
  const { data, isLoading } = useFlag(MAINTENANCE_FLAG);
  const mutation = useSetMaintenance();
  const [confirming, setConfirming] = useState<"enable" | "disable" | null>(null);

  const enabled = data?.value === true;

  const apply = async (next: boolean): Promise<void> => {
    try {
      await mutation.mutateAsync(next);
      toast.success(next ? "Maintenance mode ON." : "Maintenance mode OFF.");
    } catch (err) {
      toast.error(humanizeApiError(err, "Failed to toggle maintenance mode."));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Maintenance kill switch</CardTitle>
        <CardDescription className="text-xs">
          Forces every patient API call to return <code>MAINTENANCE_MODE</code>. Use for emergency
          drains during incidents.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-3">
        {isLoading ? (
          <Skeleton className="h-6 w-24" />
        ) : (
          <Badge variant={enabled ? "destructive" : "success"} className="text-xs">
            {enabled ? "ON" : "OFF"}
          </Badge>
        )}
        <Button
          variant={enabled ? "outline" : "destructive"}
          size="sm"
          disabled={isLoading || mutation.isPending}
          onClick={() => {
            setConfirming(enabled ? "disable" : "enable");
          }}
        >
          {mutation.isPending
            ? "Toggling…"
            : enabled
              ? "Disable maintenance"
              : "Enable maintenance"}
        </Button>
      </CardContent>
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(o) => {
          if (!o) setConfirming(null);
        }}
        title={confirming === "enable" ? "Enable maintenance mode?" : "Disable maintenance mode?"}
        description={
          confirming === "enable"
            ? "Every patient API call will return MAINTENANCE_MODE until you turn this back off. Audited."
            : "Patient traffic resumes immediately."
        }
        destructive={confirming === "enable"}
        confirmLabel={confirming === "enable" ? "Yes, enable" : "Yes, disable"}
        onConfirm={async () => {
          await apply(confirming === "enable");
        }}
      />
    </Card>
  );
}

function OtpProviderToggle() {
  const { data, isLoading } = useFlag("auth.otp.provider");
  const mutation = useSetFlag("auth.otp.provider");

  const provider = data?.value ?? "log";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">OTP Provider</CardTitle>
        <CardDescription className="text-xs">
          Controls the active OTP delivery channel. Changes take effect immediately globally.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-3">
        {isLoading ? (
          <Skeleton className="h-9 w-32" />
        ) : (
          <Select
            value={provider as string}
            disabled={mutation.isPending}
            onValueChange={(val) => {
              mutation
                .mutateAsync(val)
                .then(() => toast.success(`OTP provider changed to ${val}`))
                .catch((err) =>
                  toast.error(humanizeApiError(err, "Failed to change OTP provider")),
                );
            }}
          >
            <SelectTrigger className="w-32 h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="log">Log (Dev)</SelectItem>
              <SelectItem value="firebase">Firebase</SelectItem>
              <SelectItem value="whatsapp">WhatsApp/SMS</SelectItem>
            </SelectContent>
          </Select>
        )}
      </CardContent>
    </Card>
  );
}

// ── Rate Limits Card (Phase 4 §T.2) ────────────────────────────────
// Shows the live flag-backed ceilings and lets super_admin / ops tweak
// them without a redeploy. Changes take effect within 30s (flag cache
// TTL). Each input accepts integer values only; the flag service
// validates + stores on PATCH.

const RATE_LIMIT_FLAGS: { key: string; label: string; unit: string; fallback: number }[] = [
  { key: "rate_limit.default.free", label: "Global default", unit: "req/min", fallback: 100 },
  { key: "rate_limit.auth.free", label: "Auth surface", unit: "req/min", fallback: 10 },
  { key: "rate_limit.chat.free", label: "Chat messages", unit: "per day", fallback: 3 },
  { key: "rate_limit.readings.free", label: "Readings", unit: "per day", fallback: 20 },
];

function RateLimitRow({
  flagKey,
  label,
  unit,
  fallback,
}: {
  flagKey: string;
  label: string;
  unit: string;
  fallback: number;
}) {
  const { data, isLoading } = useFlag(flagKey);
  const mutation = useSetFlag(flagKey);
  const [draft, setDraft] = useState<string>("");
  const [editing, setEditing] = useState(false);

  const current = data?.value !== null && data?.value !== undefined ? Number(data.value) : fallback;

  const save = () => {
    const parsed = parseInt(draft, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      toast.error("Must be a positive integer");
      return;
    }
    mutation
      .mutateAsync(parsed)
      .then(() => {
        toast.success(`${label} set to ${parsed}`);
        setEditing(false);
      })
      .catch((err: unknown) => toast.error(humanizeApiError(err, `Failed to update ${label}`)));
  };

  return (
    <TableRow>
      <TableCell className="text-xs font-medium">{label}</TableCell>
      <TableCell className="text-xs text-muted-foreground font-mono">{flagKey}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{unit}</TableCell>
      <TableCell className="text-xs text-right font-mono">
        {isLoading ? (
          <Skeleton className="h-4 w-8 ml-auto" />
        ) : editing ? (
          <div className="flex items-center justify-end gap-1">
            <input
              type="number"
              min={1}
              defaultValue={current}
              className="w-16 h-7 text-xs border rounded px-1 font-mono"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") setEditing(false);
              }}
              autoFocus
            />
            <Button size="sm" className="h-7 text-xs" onClick={save} disabled={mutation.isPending}>
              {mutation.isPending ? "…" : "Save"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <button
            className="text-xs underline-offset-2 hover:underline cursor-pointer"
            onClick={() => {
              setDraft(String(current));
              setEditing(true);
            }}
          >
            {current}
          </button>
        )}
      </TableCell>
    </TableRow>
  );
}

function RateLimitsCard() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm">Rate Limits</CardTitle>
        </div>
        <CardDescription className="text-xs">
          Live flag-backed ceilings. Click a value to edit. Changes take effect within 30s (flag
          cache TTL). Auth + default are req/min; chat + readings are daily free-tier caps.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Surface</TableHead>
              <TableHead className="text-xs">Flag key</TableHead>
              <TableHead className="text-xs">Unit</TableHead>
              <TableHead className="text-xs text-right">Ceiling</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {RATE_LIMIT_FLAGS.map((f) => (
              <RateLimitRow
                key={f.key}
                flagKey={f.key}
                label={f.label}
                unit={f.unit}
                fallback={f.fallback}
              />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function OpsPage() {
  return (
    <AccessDenied allow={["super_admin", "ops"]}>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Ops &amp; health</h1>
          <p className="text-sm text-muted-foreground">
            Backend probes, BullMQ queue depth, maintenance kill switch, and rate-limit ceilings.
          </p>
        </header>
        <HealthCards />
        <QueuesCard />
        <div className="grid gap-4 md:grid-cols-2">
          <MaintenanceToggle />
          <OtpProviderToggle />
        </div>
        <RateLimitsCard />
      </div>
    </AccessDenied>
  );
}
