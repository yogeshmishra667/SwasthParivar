import { useAnalyticsMetric, useAuditLog } from "@/api/queries";
import { humanizeApiError } from "@/lib/errorMessage";
import { JsonViewer } from "@/components/shared/JsonViewer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertCircle } from "lucide-react";

interface TierDistValue {
  byTier: Record<string, number>;
}

interface TierChangeMeta {
  from?: string;
  to?: string;
}

function TierDistributionCard() {
  const { data, isLoading, isError, error } = useAnalyticsMetric("tier_distribution");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Tier distribution</CardTitle>
        <CardDescription className="text-xs">
          Current count of users at each tier — sourced from the analytics registry.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Couldn't load</AlertTitle>
            <AlertDescription>{humanizeApiError(error)}</AlertDescription>
          </Alert>
        ) : isLoading || !data ? (
          <Skeleton className="h-32 w-full" />
        ) : !data.available || data.value === null ? (
          <p className="text-xs text-muted-foreground">{data.note ?? "Unavailable."}</p>
        ) : (
          <ul className="space-y-2">
            {Object.entries((data.value as TierDistValue).byTier).map(([tier, count]) => (
              <li
                key={tier}
                className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2"
              >
                <span className="font-medium capitalize">{tier}</span>
                <span className="tabular-nums">{count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TierChangeHistoryCard() {
  const { data, isLoading, isError, error } = useAuditLog({
    action: "user.tier_changed",
    limit: 25,
  });

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="text-sm">Recent tier changes</CardTitle>
        <CardDescription className="text-xs">
          The audit trail filtered to <code>user.tier_changed</code>. This is the paid-tier history
          surface today; Phase-4 subscription + payment events will layer alongside.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Couldn't load history</AlertTitle>
            <AlertDescription>{humanizeApiError(error)}</AlertDescription>
          </Alert>
        ) : isLoading || !data ? (
          <Skeleton className="h-48 w-full" />
        ) : data.records.length === 0 ? (
          <p className="text-xs text-muted-foreground">No tier changes recorded yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Admin</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.records.map((r) => {
                const meta = (r.metadata ?? {}) as TierChangeMeta;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {new Date(r.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.adminEmail}</TableCell>
                    <TableCell className="font-mono text-xs break-all">
                      {r.targetId ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{meta.from ?? "?"}</Badge>
                      <span className="px-1 text-muted-foreground">→</span>
                      <Badge>{meta.to ?? "?"}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function BillingPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Billing &amp; plans</h1>
        <p className="text-sm text-muted-foreground">
          Tier distribution + tier-change history. Subscription / payment surfaces arrive with Phase
          4 (Razorpay + Apple IAP) and slot into the same registries — see{" "}
          <code>docs/admin-dashboard-plan.md</code>.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <TierDistributionCard />
        <TierChangeHistoryCard />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Phase 4 placeholders</CardTitle>
          <CardDescription className="text-xs">
            Where the Subscription / Payment models will render once they land.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <JsonViewer
            value={{
              subscription: "TBD — Razorpay webhooks (subscription.activated → tier up)",
              payments: "TBD — payment history per user",
              ios: "TBD — Apple IAP",
              mrr: "TBD — derived metric in the analytics registry",
              refunds: "TBD — admin action with confirm + audit",
            }}
            className="max-h-48"
          />
        </CardContent>
      </Card>
    </div>
  );
}
