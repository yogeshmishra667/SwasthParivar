import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import type { AdminPatientListItem } from "@swasth/shared-types";
import { useUsers } from "@/api/queries";
import { DataTable } from "@/components/shared/DataTable";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

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

export function UsersPage() {
  const [search, setSearch] = useState("");
  // Defer search to a memoized normalized value so we don't refetch on every keystroke.
  // (Pages can adopt a debounce hook later; for the scaffold the empty input is common.)
  const params = useMemo(() => (search.trim() ? { search } : {}), [search]);
  const { data, isLoading, isError } = useUsers(params);
  const navigate = useNavigate();

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
        <p className="text-xs text-muted-foreground">
          {data.users.length} of {data.total} · offset {data.offset}
        </p>
      ) : null}
    </div>
  );
}
