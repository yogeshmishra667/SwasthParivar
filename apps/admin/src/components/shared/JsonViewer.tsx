import { cn } from "@/lib/cn";

interface JsonViewerProps {
  value: unknown;
  className?: string;
}

/**
 * Read-only pretty-printed JSON. Used wherever we surface raw API payloads
 * (audit metadata, panel rows during scaffold, debug). Falls back to
 * `String(value)` on circular references rather than throwing.
 */
export function JsonViewer({ value, className }: JsonViewerProps) {
  let pretty: string;
  try {
    pretty = JSON.stringify(value, null, 2);
  } catch {
    pretty = String(value);
  }
  return (
    <pre
      className={cn(
        "max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed text-foreground",
        className,
      )}
    >
      {pretty}
    </pre>
  );
}
