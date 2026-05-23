import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, RotateCcw } from "lucide-react";
import {
  useEvaluateFlag,
  useFlag,
  useFlagAudit,
  useFlags,
  useRollbackFlag,
  useSetFlag,
} from "@/api/queries";
import { detectFlagKind, type FlagValue } from "@/flags/types";
import { humanizeApiError } from "@/lib/errorMessage";
import { AuditTimeline, type AuditTimelineRow } from "@/components/shared/AuditTimeline";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { DetailDrawer } from "@/components/shared/DetailDrawer";
import { FlagEditor } from "@/components/shared/FlagEditor";
import { JsonViewer } from "@/components/shared/JsonViewer";
import { RoleGate } from "@/components/shared/RoleGate";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

const KIND_LABEL: Record<string, string> = {
  boolean: "Kill switch",
  percentage: "Percentage rollout",
  cohort: "Cohort",
  cohort_or_percentage: "Cohort + percentage",
  raw: "Config",
};

const summarizeValue = (value: FlagValue): string => {
  const kind = detectFlagKind(value);
  switch (kind) {
    case "boolean":
      return value ? "on" : "off";
    case "percentage":
      return `${String((value as { percent: number }).percent)}%`;
    case "cohort":
      return `${String((value as { userIds: string[] }).userIds.length)} users`;
    case "cohort_or_percentage": {
      const v = value as { userIds: string[]; percent: number };
      return `${String(v.percent)}% + ${String(v.userIds.length)} users`;
    }
    case "raw":
      return "config";
  }
};

// ── List card ────────────────────────────────────────────────────

interface FlagSummaryProps {
  flagKey: string;
  value: FlagValue;
  onOpen: () => void;
}

function FlagSummaryCard({ flagKey, value, onOpen }: FlagSummaryProps) {
  const kind = detectFlagKind(value);
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer transition-colors hover:bg-accent/50"
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="break-all font-mono text-sm">{flagKey}</CardTitle>
        <Badge variant="outline">{KIND_LABEL[kind] ?? kind}</Badge>
      </CardHeader>
      <CardContent>
        <p className="text-sm">{summarizeValue(value)}</p>
      </CardContent>
    </Card>
  );
}

// ── Drawer body ──────────────────────────────────────────────────

interface FlagDrawerProps {
  flagKey: string;
  onClose: () => void;
}

function FlagDrawer({ flagKey, onClose }: FlagDrawerProps) {
  const { data, isLoading, isError, error } = useFlag(flagKey);
  const { data: auditData } = useFlagAudit(flagKey);
  const setMutation = useSetFlag(flagKey);
  const rollbackMutation = useRollbackFlag(flagKey);
  const evaluateMutation = useEvaluateFlag(flagKey);

  const [draft, setDraft] = useState<FlagValue | null>(null);
  const [confirmRollback, setConfirmRollback] = useState(false);
  const [evalUserId, setEvalUserId] = useState("");

  // Seed the editor from the loaded value (once).
  useEffect(() => {
    if (data?.value !== undefined && data.value !== null && draft === null) {
      setDraft(data.value);
    }
  }, [data, draft]);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Couldn't load flag</AlertTitle>
        <AlertDescription>{humanizeApiError(error)}</AlertDescription>
      </Alert>
    );
  }
  if (!data || data.value === null) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Flag has no value yet</AlertTitle>
        <AlertDescription>
          This flag key has no value in Redis. Set one to start using it.
        </AlertDescription>
      </Alert>
    );
  }
  const value = data.value;
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);

  const save = async (): Promise<void> => {
    if (draft === null) return;
    try {
      await setMutation.mutateAsync(draft);
      toast.success("Flag updated.");
    } catch (err) {
      toast.error(humanizeApiError(err, "Save failed."));
    }
  };

  const rollback = async (): Promise<void> => {
    try {
      await rollbackMutation.mutateAsync();
      setDraft(null); // re-seed from new value
      toast.success("Rolled back.");
    } catch (err) {
      toast.error(humanizeApiError(err, "Rollback failed."));
    }
  };

  const evaluate = (): void => {
    evaluateMutation.mutate(evalUserId.trim());
  };

  const auditRows: AuditTimelineRow[] =
    auditData?.records.map((r, i) => ({
      id: `${r.at}-${String(i)}`,
      actor: r.by,
      action: r.action,
      at: r.at,
      detail: (
        <div className="grid gap-1 text-xs">
          <span className="text-muted-foreground">
            {summarizeValue(r.prevValue ?? false)} →{" "}
            <strong className="text-foreground">{summarizeValue(r.newValue ?? false)}</strong>
          </span>
        </div>
      ),
    })) ?? [];

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Value</h3>
        {draft !== null ? (
          <FlagEditor value={draft} onChange={setDraft} />
        ) : (
          <p className="text-xs text-muted-foreground">Loading…</p>
        )}
        <RoleGate allow={["super_admin", "ops"]}>
          <div className="flex gap-2 pt-2">
            <Button
              disabled={!dirty || setMutation.isPending || draft === null}
              onClick={() => {
                void save();
              }}
            >
              {setMutation.isPending ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setDraft(value);
              }}
              disabled={!dirty}
            >
              Discard
            </Button>
            <Button
              variant="ghost"
              className="ml-auto"
              onClick={() => {
                setConfirmRollback(true);
              }}
            >
              <RotateCcw className="h-4 w-4" />
              Rollback
            </Button>
          </div>
        </RoleGate>
      </section>

      <Separator />

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Rollout preview</h3>
        <p className="text-xs text-muted-foreground">
          See what <code>isFeatureEnabled</code> would return for one user.
        </p>
        <div className="flex gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="eval-user-id" className="text-xs">
              User ID
            </Label>
            <Input
              id="eval-user-id"
              value={evalUserId}
              placeholder="usr_…"
              onChange={(e) => {
                setEvalUserId(e.currentTarget.value);
              }}
            />
          </div>
          <Button
            variant="outline"
            className="self-end"
            disabled={!evalUserId.trim() || evaluateMutation.isPending}
            onClick={evaluate}
          >
            {evaluateMutation.isPending ? "Checking…" : "Evaluate"}
          </Button>
        </div>
        {evaluateMutation.data ? (
          <Alert variant={evaluateMutation.data.enabled ? "success" : "default"}>
            <AlertTitle className="text-sm">
              {evaluateMutation.data.enabled ? "Enabled" : "Disabled"} for this user
            </AlertTitle>
            <AlertDescription className="text-xs">{evaluateMutation.data.reason}</AlertDescription>
          </Alert>
        ) : null}
        {evaluateMutation.isError ? (
          <p className="text-xs text-destructive">{humanizeApiError(evaluateMutation.error)}</p>
        ) : null}
      </section>

      <Separator />

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Audit timeline</h3>
        <AuditTimeline rows={auditRows} emptyMessage="No edits recorded." />
      </section>

      <Separator />

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Current value (raw)</h3>
        <JsonViewer value={value} className="max-h-40" />
      </section>

      <ConfirmDialog
        open={confirmRollback}
        onOpenChange={setConfirmRollback}
        title="Roll back to previous value?"
        description="This reverts the flag to its previous value and writes an audit entry. Cannot be undone except by another rollback."
        destructive
        confirmLabel="Yes, roll back"
        onConfirm={async () => {
          await rollback();
          onClose();
        }}
      />
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────

export function FlagsPage() {
  const { data, isLoading, isError, error } = useFlags();
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">App control</h1>
        <p className="text-sm text-muted-foreground">
          Feature flags and rollout config. Click a card to edit, roll back, or preview the rollout
          for a specific user.
        </p>
      </header>

      {isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Couldn't load flags</AlertTitle>
          <AlertDescription>{humanizeApiError(error)}</AlertDescription>
        </Alert>
      ) : null}

      {isLoading || !data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={`s-${String(i)}`} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(data.flags).map(([key, value]) => (
            <FlagSummaryCard
              key={key}
              flagKey={key}
              value={value}
              onOpen={() => {
                setOpenKey(key);
              }}
            />
          ))}
        </div>
      )}

      <DetailDrawer
        open={openKey !== null}
        onOpenChange={(open) => {
          if (!open) setOpenKey(null);
        }}
        title={<span className="font-mono text-base">{openKey ?? ""}</span>}
        description="Edit the value, preview rollout, or roll back to the previous version."
        widthClass="sm:max-w-2xl"
      >
        {openKey !== null ? (
          <FlagDrawer
            flagKey={openKey}
            onClose={() => {
              setOpenKey(null);
            }}
          />
        ) : null}
      </DetailDrawer>
    </div>
  );
}
