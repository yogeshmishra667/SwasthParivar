import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { reconcileDelta } from "./delta-reconciliation.js";
import type { ExistingItemRef } from "./types.js";
import type {
  PassACandidate,
  PassBCandidate,
} from "../prescription-paired-reconciliation/types.js";

// A small pool of clearly-distinct drug names so the similarity matcher
// behaves predictably under property generation (no accidental fuzzy
// collisions between "different" drugs).
const DRUG_NAMES = [
  "Glycomet",
  "Telma",
  "Amlodipine",
  "Atorvastatin",
  "Losartan",
  "Pantoprazole",
] as const;

const nameArb = fc.constantFrom(...DRUG_NAMES);
const confArb = fc.float({ min: Math.fround(0.5), max: 1, noNaN: true });

const existingArb: fc.Arbitrary<ExistingItemRef> = fc.record({
  id: fc.uuid(),
  aiReadName: nameArb,
  hasPairedMedicinePhoto: fc.boolean(),
});

const passAArb: fc.Arbitrary<PassACandidate> = fc.record({
  id: fc.uuid(),
  aiReadName: nameArb,
  confidence: confArb,
});

const passBArb: fc.Arbitrary<PassBCandidate> = fc.record({
  medicinePhotoId: fc.uuid(),
  aiReadName: nameArb,
  confidence: confArb,
});

/**
 * Build the prescription's item set AFTER a delta has been applied, so
 * we can re-run the same delta against the converged state. Mirrors what
 * the worker persists: promoted items gain a paired photo; new items
 * gain a paired photo iff they matched a bottle.
 */
const applyToExisting = (
  existing: readonly ExistingItemRef[],
  out: ReturnType<typeof reconcileDelta>,
): ExistingItemRef[] => {
  const promotedIds = new Set(out.promotions.map((p) => p.existingItemId));
  const updatedExisting = existing.map((e) =>
    promotedIds.has(e.id) ? { ...e, hasPairedMedicinePhoto: true } : e,
  );
  const created: ExistingItemRef[] = out.newItems.map((n) => ({
    id: `new-${n.passACandidateId}`,
    aiReadName: n.aiReadName,
    hasPairedMedicinePhoto: n.matchedMedicinePhotoId !== null,
  }));
  return [...updatedExisting, ...created];
};

describe("reconcileDelta — property: convergence", () => {
  it("applying the same delta a second time yields no new items and no promotions", () => {
    fc.assert(
      fc.property(
        fc.array(existingArb, { maxLength: 6 }),
        fc.array(passAArb, { maxLength: 6 }),
        fc.array(passBArb, { maxLength: 6 }),
        (existingItems, newPassA, newPassB) => {
          const first = reconcileDelta({ existingItems, newPassA, newPassB });
          const converged = applyToExisting(existingItems, first);
          const second = reconcileDelta({
            existingItems: converged,
            newPassA,
            newPassB,
          });
          expect(second.newItems).toHaveLength(0);
          expect(second.promotions).toHaveLength(0);
        },
      ),
    );
  });

  it("never emits more new items than survivor Pass-A candidates", () => {
    fc.assert(
      fc.property(
        fc.array(existingArb, { maxLength: 6 }),
        fc.array(passAArb, { maxLength: 6 }),
        fc.array(passBArb, { maxLength: 6 }),
        (existingItems, newPassA, newPassB) => {
          const out = reconcileDelta({ existingItems, newPassA, newPassB });
          expect(out.newItems.length + out.droppedDuplicatePassAIds.length).toBe(newPassA.length);
        },
      ),
    );
  });

  it("only promotes existing items that lacked a paired photo", () => {
    fc.assert(
      fc.property(
        fc.array(existingArb, { maxLength: 6 }),
        fc.array(passBArb, { minLength: 1, maxLength: 6 }),
        (existingItems, newPassB) => {
          const out = reconcileDelta({ existingItems, newPassA: [], newPassB });
          for (const promo of out.promotions) {
            const ref = existingItems.find((e) => e.id === promo.existingItemId);
            expect(ref?.hasPairedMedicinePhoto).toBe(false);
          }
        },
      ),
    );
  });
});
