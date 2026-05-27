import type * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Lightweight slider — a styled native `<input type="range">`. Used by
 * FlagEditor's percentage editor. We avoid `@radix-ui/react-slider` for
 * now to keep the dependency surface small; swap it in if we need
 * multi-thumb or RTL.
 */
function Slider({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  return (
    <input
      type="range"
      className={cn(
        "h-2 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Slider };
