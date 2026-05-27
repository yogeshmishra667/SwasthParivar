import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import type { AdminPatientListItem } from "@swasth/shared-types";
import { useUsers } from "@/api/queries";
import { DataTable } from "@/components/shared/DataTable";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const columns: ColumnDef<AdminPatientListItem, unknown>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "phone", header: "Phone" },
  {
    accessorKey: "tier",
    header: "Tier",
    cell: (info) => <Badge variant="outline">{String(info.getValue())}</Badge>,
  },
  { accessorKey: "age", header: "Age" },
  {
    accessorKey: "conditions",
    header: "Conditions",
    cell: (info) => (info.getValue() as string[]).join(", "),
  },
  {
    accessorKey: "onboardingComplete",
    header: "Onboarded",
    cell: (info) => (info.getValue() ? "Yes" : "No"),
  },
];

const PAGE_SIZE = 50;

export function UsersPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const navigate = useNavigate();

  // Debounce the search input — admin grids hit the server, no point
  // re-querying on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setOffset(0); // Reset paging whenever the query changes.
    }, 250);
    return () => {
      clearTimeout(t);
    };
  }, [search]);

  const params = useMemo<{ search?: string; limit: number; offset: number }>(() => {
    const out: { search?: string; limit: number; offset: number } = {
      limit: PAGE_SIZE,
      offset,
    };
    if (debouncedSearch) out.search = debouncedSearch;
    return out;
  }, [debouncedSearch, offset]);

  const { data, isLoading, isError } = useUsers(params);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">
          Patient profiles. Click a row to open the detailed 360° view.
        </p>
      </header>
      <Input
        placeholder="Search by name or phone…"
        value={search}
        onChange={(e) => {
          setSearch(e.currentTarget.value);
        }}
        className="max-w-sm"
      />
      {isError ? (
        <p className="text-sm text-destructive">Failed to load users.</p>
      ) : (
        <DataTable
          columns={columns}
          data={data?.users ?? []}
          emptyMessage={isLoading ? "Loading…" : "No users found."}
          onRowClick={(row) => {
            void navigate({ to: "/users/$id", params: { id: row.id } });
          }}
        />
      )}
      {data ? (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {data.users.length} of {data.total} · offset {data.offset}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={offset === 0 || isLoading}
              onClick={() => {
                setOffset(Math.max(0, offset - PAGE_SIZE));
              }}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!data.hasMore || isLoading}
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
  );
}
