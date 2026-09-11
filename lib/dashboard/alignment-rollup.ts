/**
 * Home-page alignment strip rollup (ALIGN-05, ROADMAP SC5). No network/DOM/clock
 * access — safe to unit test. Reduces the four per-metric `AlignmentStatus`
 * verdicts (from lib/dashboard/alignment-status.ts) into ONE worst-status-wins
 * badge plus the Copywriting Contract rollup sentence (06-UI-SPEC.md).
 *
 * BINDING GUARD (T-06-33): `rollupAlignmentStatus` returns `status: null` —
 * never the `aligned` value — when no metric is computable (an empty list, or
 * every metric's status is `null`). The strip must render the explicit
 * neutral "not yet available" state in that case, never an unearned green
 * badge just because there is nothing to disagree about yet. This is
 * enforced by a dedicated test (see
 * lib/dashboard/__tests__/alignment-rollup.test.ts) rather than by care.
 */

import type { AlignmentStatus } from "@/lib/dashboard/alignment-status";

/** One metric's verdict as input to the rollup. `status: null` means the
 * metric could not be computed for the period (e.g. its fetch failed) —
 * distinct from a computed `needs_review` verdict. */
export interface AlignmentMetricStatus {
  metric: string;
  status: AlignmentStatus | null;
}

export interface AlignmentRollupResult {
  /** Worst-status-wins verdict over the computable metrics only. `null` when
   * no metric in the input is computable — the caller must render the
   * neutral not-yet-available state, never default to `aligned`. */
  status: AlignmentStatus | null;
  /** Metric names whose status is `mismatch`, in input order. */
  mismatchedMetrics: string[];
  /** Metric names whose status is `needs_review`, in input order. */
  needsReviewMetrics: string[];
  /** Metric names whose status is `null` (uncomputable) — the caller renders
   * each of these mini-badges with its own not-available treatment rather
   * than omitting them from the row of four. */
  uncomputableMetrics: string[];
}

/**
 * Worst-status-wins: any `mismatch` beats any `needs_review`, which beats all
 * computable metrics being `aligned`. Rolls up over the computable metrics
 * only — an uncomputable metric never counts toward, or against, the verdict.
 */
export function rollupAlignmentStatus(
  metrics: AlignmentMetricStatus[],
): AlignmentRollupResult {
  const mismatchedMetrics: string[] = [];
  const needsReviewMetrics: string[] = [];
  const uncomputableMetrics: string[] = [];
  let computableCount = 0;

  for (const { metric, status } of metrics) {
    if (status === null) {
      uncomputableMetrics.push(metric);
      continue;
    }
    computableCount += 1;
    if (status === "mismatch") {
      mismatchedMetrics.push(metric);
    } else if (status === "needs_review") {
      needsReviewMetrics.push(metric);
    }
  }

  let status: AlignmentStatus | null;
  if (computableCount === 0) {
    status = null;
  } else if (mismatchedMetrics.length > 0) {
    status = "mismatch";
  } else if (needsReviewMetrics.length > 0) {
    status = "needs_review";
  } else {
    status = "aligned";
  }

  return { status, mismatchedMetrics, needsReviewMetrics, uncomputableMetrics };
}

/**
 * Copywriting Contract rollup sentence (06-UI-SPEC.md). Four shapes, in order
 * of precedence: the neutral not-yet-available sentence (status is `null`),
 * the mismatch(-plus-needs-review) compound sentence, the needs-review
 * sentence, and the all-aligned sentence.
 *
 * The needs-review sentence deliberately keeps the SAME `{n} of 4 metrics
 * need review` form at every value of n, INCLUDING the slightly ungrammatical
 * n=1 reading ("1 of 4 metrics need review: ..."). This was explicitly
 * accepted by the user during the UI-consideration probe (06-UI-SPEC.md
 * UI consideration E5) — do not "fix" it to a singular variant without asking.
 */
export function formatRollupSentence(
  rollup: AlignmentRollupResult,
  periodLabel: string,
): string {
  if (rollup.status === null) {
    return "Alignment status will appear once TSYS and Bit Addict data exist for this period.";
  }
  if (rollup.status === "mismatch") {
    const mismatchNames = rollup.mismatchedMetrics.join(", ");
    let sentence = `${rollup.mismatchedMetrics.length} of 4 metrics mismatched: ${mismatchNames}.`;
    if (rollup.needsReviewMetrics.length > 0) {
      sentence += ` ${rollup.needsReviewMetrics.length} more need review.`;
    }
    return sentence;
  }
  if (rollup.status === "needs_review") {
    const names = rollup.needsReviewMetrics.join(", ");
    return `${rollup.needsReviewMetrics.length} of 4 metrics need review: ${names}.`;
  }
  return `All four metrics are aligned for ${periodLabel}.`;
}
