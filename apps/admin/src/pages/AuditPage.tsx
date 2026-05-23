import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function AuditPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Filterable timeline of every admin mutation + sensitive-data view. Lands in M3-T8.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Coming in M3-T8</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The data flows via <code>/admin/audit</code> already — see
          <code className="ml-1">AuditTimeline</code> in the shared component library.
        </CardContent>
      </Card>
    </div>
  );
}
