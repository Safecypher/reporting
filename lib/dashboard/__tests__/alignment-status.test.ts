import { describe, expect, it } from "vitest";

import {
  alignmentStatusToLabel,
  alignmentStatusToReconciliationStatus,
  computeAlignmentShortSide,
  computeAlignmentStatus,
  computeLiveCardsGapChange,
  formatCoverageStatement,
  formatDeltaPhrase,
  formatLiveCardsDerivationCaption,
  formatLiveCardsStatusMeaningCaption,
  pctVariance,
} from "../alignment-status";

describe("computeAlignmentStatus", () => {
  it("returns 'needs_review' when coverage is incomplete even though counts are exactly equal (D-12)", () => {
    expect(computeAlignmentStatus(100, 100, 0, true, false)).toBe("needs_review");
  });

  it("returns 'aligned' when within tolerance and unsettled", () => {
    expect(computeAlignmentStatus(98, 100, 5, false, true)).toBe("aligned");
  });

  it("returns 'needs_review' when outside tolerance and unsettled", () => {
    expect(computeAlignmentStatus(50, 100, 5, false, true)).toBe("needs_review");
  });

  it("returns 'mismatch' when outside tolerance and settled", () => {
    expect(computeAlignmentStatus(50, 100, 5, true, true)).toBe("mismatch");
  });

  it("returns 'aligned' for a zero-tolerance exact match with complete coverage and settled", () => {
    expect(computeAlignmentStatus(100, 100, 0, true, true)).toBe("aligned");
  });
});

describe("computeAlignmentShortSide", () => {
  it("returns null when counts are equal", () => {
    expect(computeAlignmentShortSide(10, 10)).toBeNull();
    expect(computeAlignmentShortSide(0, 0)).toBeNull();
  });

  it("returns 'tsys' when TSYS is the lower count", () => {
    expect(computeAlignmentShortSide(90, 100)).toBe("tsys");
  });

  it("returns 'bit_addict' when Bit Addict is the lower count", () => {
    expect(computeAlignmentShortSide(100, 90)).toBe("bit_addict");
  });
});

describe("pctVariance", () => {
  it("returns null when the Bit Addict figure is zero (D-14)", () => {
    expect(pctVariance(5, 0)).toBeNull();
  });

  it("returns a one-decimal percentage denominated on the Bit Addict figure (D-13)", () => {
    expect(pctVariance(1253, 1300)).toBe(3.6);
  });
});

describe("formatDeltaPhrase", () => {
  it("renders the exact-match sentence when counts are equal", () => {
    expect(formatDeltaPhrase(100, 100)).toBe("TSYS and Bit Addict match exactly.");
  });

  it("renders a percentage when the Bit Addict figure is non-zero", () => {
    expect(formatDeltaPhrase(1253, 1300)).toBe("TSYS is short by 47 (3.6%).");
  });

  it("renders an em dash instead of a percentage when the Bit Addict figure is zero (D-14)", () => {
    expect(formatDeltaPhrase(5, 0)).toBe("Bit Addict is short by 5 (—).");
  });
});

describe("formatCoverageStatement", () => {
  it("omits the incomplete-coverage clause when both sides are fully covered", () => {
    expect(formatCoverageStatement(31, 31, 31)).toBe(
      "Coverage — TSYS 31 of 31 days · Bit Addict 31 of 31 days.",
    );
  });

  it("appends the incomplete-coverage clause when either side is short (D-12)", () => {
    expect(formatCoverageStatement(28, 31, 31)).toBe(
      "Coverage — TSYS 28 of 31 days · Bit Addict 31 of 31 days. Incomplete coverage — treated as needs review.",
    );
  });
});

describe("alignmentStatusToReconciliationStatus", () => {
  it("maps 'aligned' onto the existing 'ok' reconciliation status", () => {
    expect(alignmentStatusToReconciliationStatus("aligned")).toBe("ok");
  });

  it("passes 'needs_review' and 'mismatch' through unchanged", () => {
    expect(alignmentStatusToReconciliationStatus("needs_review")).toBe("needs_review");
    expect(alignmentStatusToReconciliationStatus("mismatch")).toBe("mismatch");
  });
});

describe("alignmentStatusToLabel", () => {
  it("returns the three Copywriting Contract badge labels", () => {
    expect(alignmentStatusToLabel("aligned")).toBe("Aligned");
    expect(alignmentStatusToLabel("needs_review")).toBe("Needs review");
    expect(alignmentStatusToLabel("mismatch")).toBe("Mismatch");
  });
});

describe("computeLiveCardsGapChange", () => {
  it("is zero when a constant offset persists unchanged across the period", () => {
    expect(computeLiveCardsGapChange(500, 500)).toBe(0);
  });

  it("returns the signed change in the gap", () => {
    expect(computeLiveCardsGapChange(500, 480)).toBe(-20);
    expect(computeLiveCardsGapChange(500, 530)).toBe(30);
  });
});

describe("live-cards verdict via computeAlignmentStatus (gap change, not level — D-07)", () => {
  it("a constant pre-window offset with no drift yields an aligned verdict at any tolerance", () => {
    // gapAtPeriodStart === gapAtPeriodEnd -> passing the two gap values
    // themselves into computeAlignmentStatus (the same trick
    // alignment_live_cards_for_period's SQL uses) yields 'aligned' even at
    // zero tolerance, regardless of how large the constant offset is.
    expect(computeAlignmentStatus(1500, 1500, 0, true, true)).toBe("aligned");
  });

  it("a gap that widens by more than the tolerance across the period yields a non-aligned verdict", () => {
    expect(computeAlignmentStatus(500, 530, 5, true, true)).toBe("mismatch");
  });

  it("an incomplete running coverage guard yields needs_review even when the gap change is zero", () => {
    expect(computeAlignmentStatus(1500, 1500, 0, true, false)).toBe("needs_review");
  });
});

describe("formatLiveCardsDerivationCaption", () => {
  it("renders the exact Copywriting Contract sentence with the offset and as-of date", () => {
    expect(formatLiveCardsDerivationCaption(1234, "2026-08-14")).toBe(
      "Cumulative enrol − unenrol from the TSYS report since 13 Aug 2026, baselined at 1,234 as of 14 Aug 2026; excludes cards live before that date.",
    );
  });

  it("renders a clearly-stated not-yet-confirmed phrasing when the as-of date is null", () => {
    expect(formatLiveCardsDerivationCaption(0, null)).toBe(
      "Cumulative enrol − unenrol from the TSYS report since 13 Aug 2026, baselined at 0 (not yet confirmed); excludes cards live before that date.",
    );
  });
});

describe("formatLiveCardsStatusMeaningCaption", () => {
  it("renders the exact Copywriting Contract sentence", () => {
    expect(formatLiveCardsStatusMeaningCaption()).toBe(
      "This status reflects the change in the gap between TSYS and Bit Addict, not the size of the gap — a permanent offset from before the data window is expected and is not flagged on its own.",
    );
  });
});
