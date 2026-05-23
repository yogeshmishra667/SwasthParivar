import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface AuditTimelineRow {
  id: string;
  /** Display name / email of who took the action. */
  actor: string;
  /** Action key, e.g. "flag.set", "user.tier_changed". */
  action: string;
  /** ISO-8601 timestamp. */
  at: string;
  /** Optional inline detail (badge, JSON snippet, etc.). */
  detail?: ReactNode;
}

interface AuditTimelineProps {
  rows: AuditTimelineRow[];
  emptyMessage?: string;
  className?: string;
}

/**
 * Vertical timeline shared across flag history, user-detail mutations,
 * and the global audit page. Pure presentation — the call site shapes
 * each row from the underlying `AdminAuditLogDto`.
 */
export function AuditTimeline({
  rows,
  emptyMessage = "No activity yet.",
  className,
}: AuditTimelineProps) {
  if (rows.length === 0) {
    return <p className={cn("text-sm text-muted-foreground", className)}>{emptyMessage}</p>;
  }
  return (
    <ol className={cn("relative space-y-4 border-l border-border pl-6", className)}>
      {rows.map((row) => (
        <li key={row.id} className="relative">
          <span className="absolute -left-[27px] top-1 h-2 w-2 rounded-full bg-primary" />
          <div className="text-sm font-medium">{row.action}</div>
          <div className="text-xs text-muted-foreground">
            {row.actor} · <time dateTime={row.at}>{new Date(row.at).toLocaleString()}</time>
          </div>
          {row.detail ? <div className="mt-1 text-sm">{row.detail}</div> : null}
        </li>
      ))}
    </ol>
  );
}
