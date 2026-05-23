import { useOpsHealth } from "@/api/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function OpsPage() {
  const { data, isLoading, isError } = useOpsHealth();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Ops &amp; health</h1>
        <p className="text-sm text-muted-foreground">
          Backend probes — queues + maintenance toggle arrive in M3-T6.
        </p>
      </header>
      {isError ? (
        <p className="text-sm text-destructive">Probe failed.</p>
      ) : isLoading || !data ? (
        <p className="text-sm text-muted-foreground">Probing…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm">Database</CardTitle>
              <Badge variant={data.database.ok ? "success" : "destructive"}>
                {data.database.ok ? "ok" : "down"}
              </Badge>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {data.database.latencyMs !== null ? `${data.database.latencyMs.toString()} ms` : "—"}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm">Redis</CardTitle>
              <Badge variant={data.redis.ok ? "success" : "destructive"}>
                {data.redis.ok ? "ok" : "down"}
              </Badge>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {data.redis.latencyMs !== null ? `${data.redis.latencyMs.toString()} ms` : "—"}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
