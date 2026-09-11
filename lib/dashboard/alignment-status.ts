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

/**
 * Steps `day` forward `n` BUSINESS days (Mon-Fri only, Sat/Sun skipped -- no
 * holiday calendar, none is in scope). Hand-mirrors
 * `add_business_days(date, int)` (`supabase/migrations/0027_alignment_coverage_and_business_days.sql`)
 * BY HAND -- if either changes, re-check the other (the 0019 convention).
 * Pure UTC date arithmetic only -- no clock or network access. Lifted
 * verbatim from `addBusinessDaysLocal` in `lib/dashboard/alignment-drill.ts`
 * (0031) -- that private copy is intentionally left in place; a later plan
 * swaps its call site over to this exported version.
 */
export function addBusinessDaysUtc(day: string, n: number): string {
  let cursor = new Date(`${day}T00:00:00Z`);
  let remaining = n;
  while (remaining > 0) {
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    // getUTCDay(): 0=Sunday...6=Saturday. isodow-equivalent weekday check:
    // Saturday (6) and Sunday (0) do not consume a business day.
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      remaining -= 1;
    }
  }
  return cursor.toISOString().slice(0, 10);
}

/** The data-window cutoff every alignment view floors an empty maximum to
 * (`'2026-08-13'::date` in SQL). A source with no rows at all has no
 * maximum -- coalescing to this floor is what makes an absent source read
 * unsettled rather than NULL (ALIGN-03 empty edge). */
const ALIGNMENT_DATA_WINDOW_START = "2026-08-13";

/**
 * The three flow metrics `v_alignment_daily`/`alignment_counterpart_max_day`
 * operate over. Mirrors `FlowAlignmentMetric`
 * (`lib/dashboard/alignment.ts` -- `Exclude<AlignmentMetric, "live-cards">`)
 * literal-for-literal; kept as an independent local type here (rather than
 * imported) so this file stays a leaf module with no dependency back on
 * `alignment.ts`, which already imports FROM this file.
 */
export type AlignmentFlowMetric = "enrolled" | "unenrolled" | "volume";

/**
 * Per-source settling predicate (CR-01/WR-01, ALIGN-03). Hand-mirrors SQL
 * `alignment_settled(date, date, date)`
 * (`supabase/migrations/0031_alignment_per_source_settling.sql`) -- if
 * either changes, re-check the other. A day is settled only once BOTH the
 * supplied TSYS maximum and the supplied counterpart maximum have
 * independently advanced `addBusinessDaysUtc(day, 3)` past `day`.
 *
 * Empty-source rule: a `null` maximum (a source with no rows at all) is
 * coalesced to the data-window cutoff before comparing -- an absent source
 * therefore reads unsettled, never `null`/`undefined` (ALIGN-03 empty edge).
 * Adjacency rule: the comparison is `>=` (inclusive) -- a maximum landing
 * EXACTLY on the threshold settles (ALIGN-03 adjacency edge), matching the
 * SQL function and the `>=` the reconciliation chain (0021) already uses.
 */
export function computeAlignmentSettled(
  day: string,
  maxTsysDay: string | null,
  maxCounterpartDay: string | null,
): boolean {
  const threshold = addBusinessDaysUtc(day, 3);
  const effectiveTsysDay = maxTsysDay ?? ALIGNMENT_DATA_WINDOW_START;
  const effectiveCounterpartDay = maxCounterpartDay ?? ALIGNMENT_DATA_WINDOW_START;
  return effectiveTsysDay >= threshold && effectiveCounterpartDay >= threshold;
}

/**
 * Selects the ONE Bit Addict source maximum that actually corresponds to
 * `metric` (CR-01 fix). Hand-mirrors SQL `alignment_counterpart_max_day(text, date, date)`
 * (`supabase/migrations/0031_alignment_per_source_settling.sql`) -- if
 * either changes, re-check the other. `'volume'` compares against
 * verifications (`maxVerificationDay`); `'enrolled'`/`'unenrolled'` compare
 * against `v_inventory_daily_diff`/`card_inventory` (`maxInventoryDay`).
 * Each flow metric is settled by its OWN counterpart source's cadence
 * alone -- a cadence divergence in the OTHER Bit Addict source can never
 * change that metric's verdict.
 */
export function alignmentCounterpartMaxDay(
  metric: AlignmentFlowMetric,
  maxInventoryDay: string,
  maxVerificationDay: string,
): string {
  return metric === "volume" ? maxVerificationDay : maxInventoryDay;
}

/**
 * Live-cards paired coverage figures (CR-02, ALIGN-02). The live-cards card's
 * coverage is a whole-window boolean pair, not a per-day count like the flow
 * metrics — this expresses it as a 1-of-1/0-of-1 pair so the shared
 * `formatCoverageStatement`/`PairedMetricCard` machinery still renders
 * correctly. `tsysCoveredDays` MUST read the TSYS-only running guard
 * (`tsysCoverageComplete`), never the RPC's combined `coverage_complete` —
 * that combined flag is the AND of both sides and can never serve as either
 * side's own figure on its own (the exact misattribution CR-02 fixes: a card
 * with a fully-covered TSYS side and no Bit Addict snapshot must read "TSYS 1
 * of 1", never "TSYS 0 of 1"). `bitAddictCoveredDays` is derived from its own
 * independent signal, snapshot presence.
 */
export function computeLiveCardsCoverageFigures(
  tsysCoverageComplete: boolean,
  bitAddictSnapshotDay: string | null,
): { tsysCoveredDays: number; bitAddictCoveredDays: number; totalDays: number } {
  return {
    tsysCoveredDays: tsysCoverageComplete ? 1 : 0,
    bitAddictCoveredDays: bitAddictSnapshotDay !== null ? 1 : 0,
    totalDays: 1,
  };
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

/**
 * D-06/D-07: live cards is a cumulative running total with no snapshot to
 * anchor it, so its verdict is computed on the CHANGE in the TSYS-vs-Bit-
 * Addict gap across the period, never on the gap's absolute level — a
 * constant, unchanging pre-window offset must never read as a mismatch on
 * its own. `gapAtPeriodStart`/`gapAtPeriodEnd` are both
 * `(tsys_live_cards - bit_addict_live_cards)`, at the day immediately
 * before the period and at the period's last day respectively
 * (`supabase/migrations/0030_v_alignment_live_cards.sql`'s
 * `alignment_live_cards_for_period` computes both server-side). This
 * function is a plain subtraction — its only purpose is to give the "gap
 * change" concept a named, unit-tested identity distinct from an inline
 * expression, matching the SQL function's own `gap_change` column.
 */
export function computeLiveCardsGapChange(
  gapAtPeriodStart: number,
  gapAtPeriodEnd: number,
): number {
  return gapAtPeriodEnd - gapAtPeriodStart;
}

const LIVE_CARDS_WINDOW_START_LABEL = "13 Aug 2026";

/** UTC-safe "d MMM yyyy" formatter for the derivation caption's as-of date,
 * matching every other dashboard caption's date format (e.g.
 * `card-inventory-kpi-cards.tsx`'s `formatDay`). */
function formatCaptionDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { dateStyle: "medium" });
}

/**
 * Copywriting Contract, live-cards permanent derivation caption (D-08):
 * states the cumulative enrol − unenrol formula, the baseline offset and its
 * as-of date, and the data-window start — always rendered directly under the
 * TSYS figure, never a tooltip (components/dashboard/alignment-kpi-cards.tsx
 * renders this verbatim, never re-worded). Renders a clearly-stated
 * not-yet-confirmed phrasing — rather than a missing/blank date — when
 * `asOfDate` is null, i.e. the offset has never been saved via
 * `/settings/general`.
 */
export function formatLiveCardsDerivationCaption(
  offset: number,
  asOfDate: string | null,
): string {
  const basisPhrase =
    asOfDate === null
      ? `baselined at ${offset.toLocaleString()} (not yet confirmed)`
      : `baselined at ${offset.toLocaleString()} as of ${formatCaptionDay(asOfDate)}`;
  return `Cumulative enrol − unenrol from the TSYS report since ${LIVE_CARDS_WINDOW_START_LABEL}, ${basisPhrase}; excludes cards live before that date.`;
}

/**
 * Copywriting Contract, live-cards status-meaning caption (D-07): a second
 * always-visible caption, positioned near the badge rather than the figure,
 * so a viewer cannot read this card's badge the same way as the other three
 * cards' badges — its verdict tracks drift in the gap, not the gap's size.
 */
export function formatLiveCardsStatusMeaningCaption(): string {
  return "This status reflects the change in the gap between TSYS and Bit Addict, not the size of the gap — a permanent offset from before the data window is expected and is not flagged on its own.";
}
