import { Model } from "@nozbe/watermelondb";
import { field } from "@nozbe/watermelondb/decorators";

// Audit P8 — a BP, cardiac, respiratory or meal log the server doesn't
// have yet. Drained by `drainPendingWrites` (services/pending-writes.ts);
// the row is removed once the server has it.
export class PendingWriteModel extends Model {
  static table = "pending_writes";

  @field("client_uuid") clientUuid!: string;
  /** The profile the log belongs to (shared phone). */
  @field("user_id") userId!: string;
  /** "bp" | "cardiac" | "respiratory" | "meal" — picks the endpoint. */
  @field("kind") kind!: string;
  /** The exact POST body. */
  @field("payload_json") payloadJson!: string;
  /** Critical when logged: sent first and never deleted by the drain. */
  @field("critical") critical!: boolean;
  /** When the reading was taken (meals: eaten), for drain order. */
  @field("taken_at") takenAt!: number;
  @field("queued_at") queuedAt!: number;
}
