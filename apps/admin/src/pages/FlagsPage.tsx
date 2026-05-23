import { useFlags } from "@/api/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { JsonViewer } from "@/components/shared/JsonViewer";
import { detectFlagKind } from "@/flags/types";

const KIND_LABEL: Record<string, string> = {
  boolean: "Kill switch",
  percentage: "Percentage rollout",
  cohort: "Cohort",
  cohort_or_percentage: "Cohort + percentage",
  raw: "Config",
};

export function FlagsPage() {
  const { data, isLoading, isError } = useFlags();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">App control</h1>
        <p className="text-sm text-muted-foreground">
          Feature flags and rollout config. The full editor (FlagEditor) lands in M3-T5.
        </p>
      </header>
      {isError ? (
        <p className="text-sm text-destructive">Failed to load flags.</p>
      ) : isLoading || !data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {Object.entries(data.flags).map(([key, value]) => {
            const kind = detectFlagKind(value);
            return (
              <Card key={key}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="font-mono text-sm">{key}</CardTitle>
                  <Badge variant="outline">{KIND_LABEL[kind] ?? kind}</Badge>
                </CardHeader>
                <CardContent>
                  <JsonViewer value={value} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
