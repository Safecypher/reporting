import { describe, expect, it } from "vitest";

import {
  addBusinessDaysUtc,
  alignmentCounterpartMaxDay,
  computeAlignmentSettled,
} from "../alignment-status";

/**
 * Deliberate divergent-freshness, exact-boundary and absent-source coverage
 * for the 0031 per-source settling fix (CR-01/WR-01, ALIGN-03). These cases
 * prove the fix without depending on the current live dataset, which
 * 06-VERIFICATION.md recorded as too sparse to reach the buggy paths.
 */

describe("computeAlignmentSettled", () => {
  it("is false when TSYS is far ahead but the counterpart is still short (the CR-01 case)", () => {
    expect(computeAlignmentSettled("2026-08-14", "2026-09-30", "2026-08-15")).toBe(false);
  });

  it("is false when the counterpart is fresh but TSYS is stale (the mirror image)", () => {
    expect(computeAlignmentSettled("2026-08-14", "2026-08-15", "2026-09-30")).toBe(false);
  });

  it("is true when both sides are far ahead of the settling threshold", () => {
    expect(computeAlignmentSettled("2026-08-14", "2026-09-30", "2026-09-30")).toBe(true);
  });

  it("is true at the exact boundary — inclusive on both sides", () => {
    expect(computeAlignmentSettled("2026-08-14", "2026-08-19", "2026-08-19")).toBe(true);
  });

  it("is false when one side is a single calendar day short of the boundary", () => {
    expect(computeAlignmentSettled("2026-08-14", "2026-08-18", "2026-08-19")).toBe(false);
  });

  it("is false, never null, when a counterpart source has no rows at all", () => {
    const result = computeAlignmentSettled("2026-08-14", null, "2026-09-30");
    expect(result).toBe(false);
    expect(result).not.toBeNull();
    expect(result).not.toBeUndefined();
    expect(typeof result).toBe("boolean");
  });
});

describe("alignmentCounterpartMaxDay", () => {
  it("selects the verification maximum for 'volume'", () => {
    expect(alignmentCounterpartMaxDay("volume", "2026-08-15", "2026-09-30")).toBe("2026-09-30");
  });

  it("selects the inventory maximum for 'enrolled'", () => {
    expect(alignmentCounterpartMaxDay("enrolled", "2026-08-15", "2026-09-30")).toBe("2026-08-15");
  });

  it("selects the inventory maximum for 'unenrolled'", () => {
    expect(alignmentCounterpartMaxDay("unenrolled", "2026-08-15", "2026-09-30")).toBe("2026-08-15");
  });
});

describe("addBusinessDaysUtc", () => {
  it("Friday plus three business days skips the weekend and lands on Wednesday", () => {
    expect(addBusinessDaysUtc("2026-08-14", 3)).toBe("2026-08-19");
  });

  it("Monday plus three business days crosses no weekend at all", () => {
    expect(addBusinessDaysUtc("2026-08-17", 3)).toBe("2026-08-20");
  });

  it("zero business days is the identity case", () => {
    expect(addBusinessDaysUtc("2026-08-13", 0)).toBe("2026-08-13");
  });

  it("a Saturday start plus one business day lands on the following Monday", () => {
    expect(addBusinessDaysUtc("2026-08-15", 1)).toBe("2026-08-17");
  });
});
