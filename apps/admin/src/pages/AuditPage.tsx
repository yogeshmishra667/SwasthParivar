import { Fragment, useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { useAuditLog } from "@/api/queries";
import { humanizeApiError } from "@/lib/errorMessage";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { JsonViewer } from "@/components/shared/JsonViewer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PAGE_SIZE = 50;

interface FilterDraft {
  action: string;
  adminUserId: string;
}

export function AuditPage() {
  const [draft, setDraft] = useState<FilterDraft>({ action: "", adminUserId: "" });
  const [applied, setApplied] = useState<FilterDraft>({ action: "", adminUserId: "" });
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const params = useMemo<{
    action?: string;
    adminUserId?: string;
    limit: number;
    offset: number;
  }>(() => {
    const out: { action?: string; adminUserId?: string; limit: number; offset: number } = {
      limit: PAGE_SIZE,
      offset,
    };
    if (applied.action.trim()) out.action = applied.action.trim();
    if (applied.adminUserId.trim()) out.adminUserId = applied.adminUserId.trim();
    return out;
  }, [applied, offset]);

  const { data, isLoading, isError, error } = useAuditLog(params);

  const apply = (): void => {
    setApplied(draft);
    setOffset(0);
  };

  const clear = (): void => {
    setDraft({ action: "", adminUserId: "" });
    setApplied({ action: "", adminUserId: "" });
    setOffset(0);
  };

  return (
    <AccessDenied allow={["super_admin", "ops"]}>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
          <p className="text-sm text-muted-foreground">
            Every admin mutation + every sensitive-data view. Super_admin / ops only.
          </p>
        </header>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="filter-action" className="text-xs">
              Action
            </Label>
            <Input
              id="filter-action"
              placeholder="e.g. flag.set"
              value={draft.action}
              onChange={(e) => {
                setDraft((d) => ({ ...d, action: e.currentTarget.value }));
              }}
              className="w-48"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="filter-admin" className="text-xs">
              Admin user ID
            </Label>
            <Input
              id="filter-admin"
              placeholder="adm_…"
              value={draft.adminUserId}
              onChange={(e) => {
                setDraft((d) => ({ ...d, adminUserId: e.currentTarget.value }));
              }}
              className="w-56"
            />
          </div>
          <Button onClick={apply}>Apply</Button>
          <Button variant="ghost" onClick={clear}>
            Clear
          </Button>
        </div>

        {isError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Couldn't load audit log</AlertTitle>
            <AlertDescription>{humanizeApiError(error)}</AlertDescription>
          </Alert>
        ) : null}

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>IP</TableHead>
                <TableHead className="text-right">Metadata</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ) : !data || data.records.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No audit records match these filters.
                  </TableCell>
                </TableRow>
              ) : (
                data.records.map((r) => (
                  <Fragment key={r.id}>
                    <TableRow>
                      <TableCell className="whitespace-nowrap text-xs">
                        {new Date(r.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.adminEmail}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">
                          {r.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.targetType ? `${r.targetType}:${r.targetId ?? "—"}` : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {r.ip ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.metadata ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setExpanded((cur) => (cur === r.id ? null : r.id));
                            }}
                          >
                            {expanded === r.id ? "Hide" : "View"}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                    {expanded === r.id && r.metadata ? (
                      <TableRow key={`${r.id}-meta`}>
                        <TableCell colSpan={6} className="bg-muted/30">
                          <JsonViewer value={r.metadata} className="max-h-64" />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {data ? (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {data.records.length} of {data.total} · offset {data.offset}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={offset === 0}
                onClick={() => {
                  setOffset(Math.max(0, offset - PAGE_SIZE));
                }}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!data.hasMore}
                onClick={() => {
                  setOffset(offset + PAGE_SIZE);
                }}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </AccessDenied>
  );
}
