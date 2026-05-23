import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Compose Tailwind class strings safely. `clsx` flattens conditionals;
 * `twMerge` resolves conflicts (e.g. `p-2 p-4` → `p-4`) so component
 * overrides Just Work. Use everywhere classes are composed.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
