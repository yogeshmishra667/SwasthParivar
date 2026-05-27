import { useState, useRef, useEffect } from "react";
import { useUsers } from "@/api/queries";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { AdminPatientListItem } from "@swasth/shared-types";

interface UserSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onSelect?: () => void;
  placeholder?: string;
  className?: string;
  id?: string;
}

export function UserSearchInput({
  value,
  onChange,
  onSelect,
  placeholder,
  className,
  id,
}: UserSearchInputProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close the dropdown if clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Debounce the search input for the query
  const [debouncedSearch, setDebouncedSearch] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(value);
    }, 300);
    return () => clearTimeout(timer);
  }, [value]);

  const { data, isLoading } = useUsers({ search: debouncedSearch, limit: 5 });

  return (
    <div className={`relative ${className ?? ""}`} ref={containerRef}>
      <Input
        id={id}
        value={value}
        placeholder={placeholder ?? "Search user by name, phone, or ID..."}
        onChange={(e) => {
          onChange(e.currentTarget.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (value.length > 0) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onSelect) {
            e.preventDefault();
            onSelect();
            setOpen(false);
          }
        }}
      />
      {open && value.trim().length > 0 && (
        <Card className="absolute z-50 mt-1 w-full max-h-60 overflow-auto p-1 shadow-md bg-popover">
          {isLoading ? (
            <div className="p-2 space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : data?.users && data.users.length > 0 ? (
            <ul className="text-sm">
              {data.users.map((u: AdminPatientListItem) => (
                <li
                  key={u.id}
                  className="cursor-pointer rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
                  onClick={() => {
                    onChange(u.id);
                    setOpen(false);
                  }}
                >
                  <div className="font-medium text-xs">{u.name || "Unnamed"}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">
                    {u.phone} • {u.id}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-2 text-xs text-muted-foreground text-center">No users found.</div>
          )}
        </Card>
      )}
    </div>
  );
}
