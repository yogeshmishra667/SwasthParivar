// Frontend mirror of the server's `AdminResourceRegistry`. The user
// detail page maps over the server-provided `panels: AdminResourcePanelMeta[]`
// and calls into this registry to render each panel's rows.
//
// Adding a Phase 4 entity (CardiacLog, RespiratoryLog, Prescription, …)
// = register one entry here AND one on the server registry — no changes
// to the user detail page itself.

import type { ReactNode } from "react";
import type { AdminResourcePanelData } from "@swasth/shared-types";
import { JsonViewer } from "@/components/shared/JsonViewer";

export interface UserPanelEntry {
  /** Renderer for one page of resource rows. */
  render: (data: AdminResourcePanelData) => ReactNode;
}

interface GenericPanelTableProps {
  data: AdminResourcePanelData;
}

/**
 * Fallback renderer — pretty-prints `data.rows` as JSON inside a small
 * pagination header. M2 ships every panel using this; M3 specializes
 * the high-traffic ones (glucose readings, BP readings, chat messages,
 * guardian alerts) with bespoke columns.
 */
function GenericPanelTable({ data }: GenericPanelTableProps) {
  if (data.rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No rows.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Showing {data.rows.length} of {data.total} · offset {data.offset}
      </p>
      <JsonViewer value={data.rows} />
    </div>
  );
}

const generic: UserPanelEntry = {
  render: (data) => <GenericPanelTable data={data} />,
};

/**
 * Keys mirror `apps/server/src/modules/admin/registry/admin-resource.registry.ts`.
 * Any key not listed falls back to the generic renderer via `renderUserPanel`.
 */
export const userPanelRegistry: Record<string, UserPanelEntry> = {
  glucose_readings: generic,
  bp_readings: generic,
  meal_logs: generic,
  medication_schedules: generic,
  medication_logs: generic,
  insight_events: generic,
  health_scores: generic,
  chat_sessions: generic,
  chat_messages: generic,
  silent_guardian_signals: generic,
  guardian_alerts: generic,
  family_links: generic,
  emergency_contacts: generic,
  push_tokens: generic,
};

/** Single entry point used by the User Detail page. */
export function renderUserPanel(data: AdminResourcePanelData): ReactNode {
  const entry = userPanelRegistry[data.key] ?? generic;
  return entry.render(data);
}
