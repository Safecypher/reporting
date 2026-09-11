/**
 * Pure alignment truth table (D-12 binding). No network/DOM/clock access —
 * safe to unit test, and the single source of truth the SQL
 * `alignment_status` function (supabase/migrations/0028_v_alignment_daily.sql)
 * MUST mirror by hand — the same discipline 0019's header comment
 * establishes for its own case/reconciliation-status.ts pairing. If either
 * file changes, re-check the other.
 *
 * INVERTED PRIORITY ORDER (the whole point of this phase's status ladder,
 * D-12/RESEARCH Pitfall 1): `lib/dashboard/reconciliation-status.ts` checks
 * equality FIRST so a quiet, genuinely-zero day never floods the
 * reconciliation table with a false "no report" row. Alignment does the
 * opposite on purpose: incomplete coverage wins UNCONDITIONALLY, even over
 * an exact numeric match. A confidently-green month built on missing days is
 * precisely the failure this page exists to prevent — copying
 * reconciliation-status.ts's ordering here would let two uncovered sources
 * that both happen to read zero render as "Aligned". Do not reorder the
 * checks below.
 *
 * `settled` is always an INPUT here, never derived from a wall clock, same
 * as reconciliation-status.ts — the SQL view supplies it based on whether
 * both sides' own max observed day has advanced past `add_business_days`
 * (0027) of this row's day.
 */

import type { ReconciliationStatus } from "@/lib/dashboard/reconciliation-status";

export type AlignmentStatus = "aligned" | "needs_review" | "mismatch";

export type AlignmentShortSide = "tsys" | "bit_addict" | null;

export interface AlignmentBadgeDescriptor {
  label: string;
  variant: AlignmentStatus;
}

/**
 * Truth table, in order — the order is the point:
 * - coverage incomplete           -> 'needs_review' (unconditional, checked
 *   FIRST, regardless of how small the variance is — D-12)
 * - within tolerance              -> 'aligned'
 * - outside tolerance, settled    -> 'mismatch'
 * - outside tolerance, unsettled  -> 'needs_review' (pending — the
 *   counterpart's most-recent day hasn't landed yet)
 */
export function computeAlignmentStatus(
  tsysCount: number,
  bitAddictCount: number,
  toleranceCount: number,
  settled: boolean,
  coverageComplete: boolean,
): AlignmentStatus {
  if (!coverageComplete) return "needs_review";
  const withinTolerance = Math.abs(tsysCount - bitAddictCount) <= toleranceCount;
  if (withinTolerance) return "aligned";
  return settled ? "mismatch" : "needs_review";
}

/** Which side is short (lower count) when the two disagree, else null. */
export function computeAlignmentShortSide(
  tsysCount: number,
  bitAddictCount: number,
): AlignmentShortSide {
  if (tsysCount === bitAddictCount) return null;
  return tsysCount < bitAddictCount ? "tsys" : "bit_addict";
}

/**
 * Percentage variance, always denominated on the Bit Addict figure (D-13 —
 * our own systems, the source we control, the basis every other page already
 * reports from). Returns null when the Bit Addict figure is zero (D-14) —
 * never a fabricated 100%/Infinity and never a denominator swap. One
 * decimal place.
 */
export function pctVariance(tsysCount: number, bitAddictCount: number): number | null {
  if (bitAddictCount === 0) return null;
  return Math.round((Math.abs(tsysCount - bitAddictCount) / bitAddictCount) * 1000) / 10;
}

const SHORT_SIDE_LABEL: Record<Exclude<AlignmentShortSide, null>, string> = {
  tsys: "TSYS",
  bit_addict: "Bit Addict",
};

/**
 * Copywriting Contract delta phrase — three shapes: the exact-match
 * sentence; a percentage when the Bit Addict figure is non-zero; an em dash
 * (never a fabricated percentage) when it is zero (D-14). This is the plain
 * pure-string form; components/dashboard/alignment-kpi-cards.tsx renders the
 * em-dash case with an additional accessible span wrapper rather than
 * calling this function directly, so the reason reaches the accessibility
 * tree unconditionally, not behind hover (D-14/UI-SPEC).
 */
export function formatDeltaPhrase(tsysCount: number, bitAddictCount: number): string {
  if (tsysCount === bitAddictCount) {
    return "TSYS and Bit Addict match exactly.";
  }
  const shortSide = computeAlignmentShortSide(tsysCount, bitAddictCount);
  const absDelta = Math.abs(tsysCount - bitAddictCount);
  const pct = pctVariance(tsysCount, bitAddictCount);
  const pctLabel = pct === null ? "—" : `${pct}%`;
  const sideLabel = SHORT_SIDE_LABEL[shortSide as Exclude<AlignmentShortSide, null>];
  return `${sideLabel} is short by ${absDelta.toLocaleString()} (${pctLabel}).`;
}

/**
 * Copywriting Contract coverage statement — always states both sides' day
 * counts, and appends the incomplete-coverage clause whenever either side is
 * short (D-12: the coverage line and the badge must always agree — a card
 * can never show "Aligned" while its own coverage statement admits a gap).
 */
export function formatCoverageStatement(
  tsysCoveredDays: number,
  bitAddictCoveredDays: number,
  totalDays: number,
): string {
  const base = `Coverage — TSYS ${tsysCoveredDays} of ${totalDays} days · Bit Addict ${bitAddictCoveredDays} of ${totalDays} days.`;
  const incomplete = tsysCoveredDays < totalDays || bitAddictCoveredDays < totalDays;
  return incomplete ? `${base} Incomplete coverage — treated as needs review.` : base;
}

/**
 * Maps the alignment status onto the existing three-state
 * `ReconciliationStatus` so the shared `StatusBadge` can render it via a
 * label override (D-01/RESEARCH Pitfall 4 — an extension, not a fork:
 * `ReconciliationStatus` itself is never widened). `aligned` reuses the `ok`
 * success tokens; `needs_review`/`mismatch` pass through unchanged (both
 * types share the same literal values for these two).
 */
export function alignmentStatusToReconciliationStatus(
  status: AlignmentStatus,
): ReconciliationStatus {
  if (status === "aligned") return "ok";
  return status;
}

/** Copywriting Contract badge labels. */
export function alignmentStatusToLabel(status: AlignmentStatus): string {
  switch (status) {
    case "aligned":
      return "Aligned";
    case "needs_review":
      return "Needs review";
    case "mismatch":
      return "Mismatch";
  }
}

/**
 * Row-tinting classes for the future day-breakdown drill table (Plan
 * 06-04), generalising `reconciliationStatusToRowClassName`'s three
 * coloured branches to the alignment status set — no fourth
 * `no_source_data` branch, since alignment has no equivalent state:
 * coverage incompleteness IS `needs_review` here (D-12).
 */
export function alignmentStatusToRowClassName(status: AlignmentStatus): string {
  switch (status) {
    case "aligned":
      return "border-l-4 border-l-[color:var(--success)] bg-[color:var(--success)]/5";
    case "needs_review":
      return "border-l-4 border-l-[color:var(--warning)] bg-[color:var(--warning)]/5";
    case "mismatch":
      return "border-l-4 border-l-destructive bg-destructive/5";
  }
}
