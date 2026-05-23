import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface KpiCardProps {
  title: string;
  /** Pre-formatted value (number / string / node). `null` shows a skeleton. */
  value: ReactNode | null;
  /** Secondary line (e.g. "+12 this week"). */
  caption?: ReactNode;
  /** Lucide icon component, rendered at 16px. */
  icon?: ReactNode;
  /** Set when the metric is unavailable (PostHog not wired / compute failed). */
  unavailable?: string | null;
  className?: string;
}

/**
 * The atomic KPI tile used on the overview and per-section dashboards.
 * Three visual states: skeleton (`value === null && !unavailable`),
 * unavailable (em-dash + note), and resolved (large value + caption).
 */
export function KpiCard({ title, value, caption, icon, unavailable, className }: KpiCardProps) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {icon ? <div className="text-muted-foreground [&_svg]:size-4">{icon}</div> : null}
      </CardHeader>
      <CardContent>
        {unavailable ? (
          <div>
            <div className="text-2xl font-semibold text-muted-foreground/60">—</div>
            <p className="mt-1 text-xs text-muted-foreground">{unavailable}</p>
          </div>
        ) : value === null ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div>
            <div className="text-2xl font-semibold">{value}</div>
            {caption ? <p className="mt-1 text-xs text-muted-foreground">{caption}</p> : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
