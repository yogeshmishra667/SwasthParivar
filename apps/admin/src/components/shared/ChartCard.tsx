import type { ReactElement, ReactNode } from "react";
import { ResponsiveContainer } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";

interface ChartCardProps {
  title: ReactNode;
  description?: ReactNode;
  /** Pixel height of the chart area. */
  height?: number;
  /** The Recharts element to render — passed straight to ResponsiveContainer. */
  children: ReactElement;
  className?: string;
}

/**
 * Wraps any Recharts chart in a titled Card with a responsive container.
 * Charts use the `--color-chart-1..5` theme tokens — pass them as
 * `stroke="var(--color-chart-1)"` so dark mode flips automatically.
 */
export function ChartCard({
  title,
  description,
  height = 240,
  children,
  className,
}: ChartCardProps) {
  return (
    <Card className={cn(className)}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
