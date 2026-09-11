import { describe, expect, it } from "vitest";

import { formatRollupSentence, rollupAlignmentStatus } from "../alignment-rollup";

const ALIGNED = { metric: "Enrolled cards", status: "aligned" as const };
const UNENROLLED_ALIGNED = { metric: "Unenrolled cards", status: "aligned" as const };
const LIVE_CARDS_ALIGNED = { metric: "Live cards", status: "aligned" as const };
const VOLUME_ALIGNED = { metric: "Transaction volume", status: "aligned" as const };

describe("rollupAlignmentStatus", () => {
  it("returns 'aligned' when all four metrics are aligned", () => {
    const result = rollupAlignmentStatus([
      ALIGNED,
      UNENROLLED_ALIGNED,
      LIVE_CARDS_ALIGNED,
      VOLUME_ALIGNED,
    ]);
    expect(result.status).toBe("aligned");
    expect(result.mismatchedMetrics).toEqual([]);
    expect(result.needsReviewMetrics).toEqual([]);
    expect(result.uncomputableMetrics).toEqual([]);
  });

  it("returns 'mismatch' when one of four is mismatched and the rest are aligned", () => {
    const result = rollupAlignmentStatus([
      ALIGNED,
      UNENROLLED_ALIGNED,
      { metric: "Live cards", status: "mismatch" as const },
      VOLUME_ALIGNED,
    ]);
    expect(result.status).toBe("mismatch");
    expect(result.mismatchedMetrics).toEqual(["Live cards"]);
  });

  it("returns 'needs_review' when one of four needs review and the rest are aligned", () => {
    const result = rollupAlignmentStatus([
      ALIGNED,
      UNENROLLED_ALIGNED,
      { metric: "Live cards", status: "needs_review" as const },
      VOLUME_ALIGNED,
    ]);
    expect(result.status).toBe("needs_review");
    expect(result.needsReviewMetrics).toEqual(["Live cards"]);
  });

  it("returns 'mismatch' when a mismatch and a needs-review both exist — mismatch outranks needs review", () => {
    const result = rollupAlignmentStatus([
      { metric: "Enrolled cards", status: "mismatch" as const },
      { metric: "Unenrolled cards", status: "needs_review" as const },
      LIVE_CARDS_ALIGNED,
      VOLUME_ALIGNED,
    ]);
    expect(result.status).toBe("mismatch");
    expect(result.mismatchedMetrics).toEqual(["Enrolled cards"]);
    expect(result.needsReviewMetrics).toEqual(["Unenrolled cards"]);
  });

  it("returns null (never 'aligned') for an empty list — guard against an unearned all-clear", () => {
    const result = rollupAlignmentStatus([]);
    expect(result.status).toBeNull();
  });

  it("returns null (never 'aligned') when every metric is uncomputable — guard against an unearned all-clear", () => {
    const result = rollupAlignmentStatus([
      { metric: "Enrolled cards", status: null },
      { metric: "Unenrolled cards", status: null },
      { metric: "Live cards", status: null },
      { metric: "Transaction volume", status: null },
    ]);
    expect(result.status).toBeNull();
    expect(result.uncomputableMetrics).toEqual([
      "Enrolled cards",
      "Unenrolled cards",
      "Live cards",
      "Transaction volume",
    ]);
  });

  it("rolls up over the computable metrics only and reports which were uncomputable", () => {
    const result = rollupAlignmentStatus([
      ALIGNED,
      { metric: "Unenrolled cards", status: null },
      { metric: "Live cards", status: "needs_review" as const },
      VOLUME_ALIGNED,
    ]);
    expect(result.status).toBe("needs_review");
    expect(result.uncomputableMetrics).toEqual(["Unenrolled cards"]);
    expect(result.needsReviewMetrics).toEqual(["Live cards"]);
  });
});

describe("formatRollupSentence", () => {
  it("renders the all-aligned sentence", () => {
    const result = rollupAlignmentStatus([
      ALIGNED,
      UNENROLLED_ALIGNED,
      LIVE_CARDS_ALIGNED,
      VOLUME_ALIGNED,
    ]);
    expect(formatRollupSentence(result, "August 2026")).toBe(
      "All four metrics are aligned for August 2026.",
    );
  });

  it("renders the needs-review sentence naming the affected metrics", () => {
    const result = rollupAlignmentStatus([
      ALIGNED,
      { metric: "Unenrolled cards", status: "needs_review" as const },
      { metric: "Live cards", status: "needs_review" as const },
      VOLUME_ALIGNED,
    ]);
    expect(formatRollupSentence(result, "August 2026")).toBe(
      "2 of 4 metrics need review: Unenrolled cards, Live cards.",
    );
  });

  it("keeps the single '{n} of 4 metrics need review' form at n=1 — deliberately slightly ungrammatical, accepted by the user during the UI-consideration probe. Do not pluralise this without asking.", () => {
    const result = rollupAlignmentStatus([
      ALIGNED,
      { metric: "Unenrolled cards", status: "needs_review" as const },
      LIVE_CARDS_ALIGNED,
      VOLUME_ALIGNED,
    ]);
    expect(formatRollupSentence(result, "August 2026")).toBe(
      "1 of 4 metrics need review: Unenrolled cards.",
    );
  });

  it("renders the mismatch sentence naming the affected metrics", () => {
    const result = rollupAlignmentStatus([
      { metric: "Enrolled cards", status: "mismatch" as const },
      { metric: "Unenrolled cards", status: "mismatch" as const },
      LIVE_CARDS_ALIGNED,
      VOLUME_ALIGNED,
    ]);
    expect(formatRollupSentence(result, "August 2026")).toBe(
      "2 of 4 metrics mismatched: Enrolled cards, Unenrolled cards.",
    );
  });

  it("renders the mismatch-plus-needs-review compound sentence", () => {
    const result = rollupAlignmentStatus([
      { metric: "Enrolled cards", status: "mismatch" as const },
      { metric: "Unenrolled cards", status: "needs_review" as const },
      LIVE_CARDS_ALIGNED,
      VOLUME_ALIGNED,
    ]);
    expect(formatRollupSentence(result, "August 2026")).toBe(
      "1 of 4 metrics mismatched: Enrolled cards. 1 more need review.",
    );
  });

  it("renders the neutral not-yet-available sentence when nothing is computable — never a default green sentence", () => {
    const result = rollupAlignmentStatus([
      { metric: "Enrolled cards", status: null },
      { metric: "Unenrolled cards", status: null },
      { metric: "Live cards", status: null },
      { metric: "Transaction volume", status: null },
    ]);
    expect(formatRollupSentence(result, "August 2026")).toBe(
      "Alignment status will appear once TSYS and Bit Addict data exist for this period.",
    );
  });

  it("renders the same neutral sentence for an empty metrics list", () => {
    const result = rollupAlignmentStatus([]);
    expect(formatRollupSentence(result, "August 2026")).toBe(
      "Alignment status will appear once TSYS and Bit Addict data exist for this period.",
    );
  });
});
