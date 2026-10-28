// The local DB resets (data loss: unsynced readings, the offline queue)
// when the schema version rises with no migration for it. A migration's
// columns are a copy of the schema's, so check the copies still match.
import { dbMigrations } from "@/db/migrations";
import { dbSchema } from "@/db/schema";

interface Step {
  type: string;
  schema?: { name: string; columnArray: unknown[] };
}

const steps = dbMigrations.sortedMigrations.flatMap((m) => m.steps as Step[]);

describe("WatermelonDB schema vs migrations", () => {
  it("has a migration up to the schema version", () => {
    expect(dbMigrations.maxVersion).toBe(dbSchema.version);
  });

  it("each created table matches the schema (no table is altered after creation)", () => {
    expect(steps.every((s) => s.type === "create_table")).toBe(true);
    for (const step of steps) {
      const table = dbSchema.tables[step.schema!.name];
      expect(table).toBeDefined();
      expect(step.schema!.columnArray).not.toEqual([]);
      expect(step.schema!.columnArray).toEqual(table!.columnArray);
    }
  });

  it("creates the offline queue table in v3", () => {
    const v3 = dbMigrations.sortedMigrations.find((m) => m.toVersion === 3);
    expect((v3?.steps as Step[]).map((s) => s.schema?.name)).toEqual(["pending_writes"]);
  });
});
