import { isPrescriptionApprover } from "@/utils/isPrescriptionApprover";

describe("isPrescriptionApprover", () => {
  it.each([
    ["guardian-1", "guardian-1", true],
    ["guardian-1", "patient-1", false],
    ["guardian-1", null, false],
    // Audit P6: no guardian linked any more → nobody may approve, and a
    // signed-out user must not match the null approver.
    [null, null, false],
    [null, "patient-1", false],
    [undefined, null, false],
  ] as const)("approver %s, current user %s → %s", (approver, current, expected) => {
    expect(isPrescriptionApprover(approver, current)).toBe(expected);
  });
});
