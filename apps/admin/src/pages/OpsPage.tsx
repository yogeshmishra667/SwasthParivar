import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Activity, Database, ServerCog } from "lucide-react";
import { useFlag, useSetFlag, useOpsHealth, useOpsQueues, useSetMaintenance } from "@/api/queries";
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

export function OpsPage() {
  return (
    <AccessDenied allow={["super_admin", "ops"]}>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Ops &amp; health</h1>
          <p className="text-sm text-muted-foreground">
            Backend probes, BullMQ queue depth, and the maintenance kill switch.
          </p>
        </header>
        <HealthCards />
        <QueuesCard />
        <div className="grid gap-4 md:grid-cols-2">
          <MaintenanceToggle />
          <OtpProviderToggle />
        </div>
      </div>
    </AccessDenied>
  );
}
