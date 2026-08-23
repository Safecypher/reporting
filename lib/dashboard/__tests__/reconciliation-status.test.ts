import { describe, expect, it } from "vitest";

import {
  computeReconciliationStatus,
  computeShortSide,
  reconciliationStatusToBadge,
} from "../reconciliation-status";

describe("computeReconciliationStatus", () => {
  it("returns 'ok' when counts are equal (non-zero)", () => {
    expect(computeReconciliationStatus(10, 10, true)).toBe("ok");
    expect(computeReconciliationStatus(10, 10, false)).toBe("ok");
  });

  it("returns 'ok' when counts are equal at zero (edge case)", () => {
    expect(computeReconciliationStatus(0, 0, true)).toBe("ok");
    expect(computeReconciliationStatus(0, 0, false)).toBe("ok");
  });

  it("returns 'needs_review' when counts differ and the day is unsettled", () => {
    expect(computeReconciliationStatus(10, 9, false)).toBe("needs_review");
    expect(computeReconciliationStatus(9, 10, false)).toBe("needs_review");
  });

  it("returns 'mismatch' when counts differ and the day is settled", () => {
    expect(computeReconciliationStatus(10, 9, true)).toBe("mismatch");
    expect(computeReconciliationStatus(9, 10, true)).toBe("mismatch");
  });

  it("boundary: delta of exactly 1, settled -> mismatch", () => {
    expect(computeReconciliationStatus(101, 100, true)).toBe("mismatch");
  });

  it("boundary: delta of exactly 1, unsettled -> needs_review", () => {
    expect(computeReconciliationStatus(101, 100, false)).toBe("needs_review");
  });
});

describe("computeShortSide", () => {
  it("returns null when counts are equal", () => {
    expect(computeShortSide(5, 5)).toBeNull();
    expect(computeShortSide(0, 0)).toBeNull();
  });

  it("returns 'billing' when billing < verification", () => {
    expect(computeShortSide(4, 5)).toBe("billing");
  });

  it("returns 'verification' when verification < billing", () => {
    expect(computeShortSide(5, 4)).toBe("verification");
  });
});

describe("reconciliationStatusToBadge", () => {
  it("maps 'ok' to the OK badge descriptor", () => {
    expect(reconciliationStatusToBadge("ok")).toEqual({
      label: "OK",
      variant: "ok",
    });
  });

  it("maps 'needs_review' to the Needs review badge descriptor", () => {
    expect(reconciliationStatusToBadge("needs_review")).toEqual({
      label: "Needs review",
      variant: "needs_review",
    });
  });

  it("maps 'mismatch' to the Mismatch badge descriptor", () => {
    expect(reconciliationStatusToBadge("mismatch")).toEqual({
      label: "Mismatch",
      variant: "mismatch",
    });
  });
});
