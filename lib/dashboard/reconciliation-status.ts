/**
 * Pure reconciliation settling state machine (D-03). No network/DOM/clock
 * access — safe to unit test and the single source of truth for the logic
 * that migrations 0018/0019/0020/0022's SQL `case` expressions MUST mirror
 * exactly. If this file changes, re-check those views by hand.
 *
 * `settled` is always an INPUT here, never derived from a wall clock
 * (Pitfall 1): the SQL view supplies it based on whether the *next*
 * calendar day already has data (max(day_utc) has moved past this row).
 * This module has no knowledge of "today" or "now".
 */

export type ReconciliationStatus = "ok" | "needs_review" | "mismatch" | "no_source_data";

export type ShortSide = "billing" | "verification" | null;

export interface ReconciliationBadgeDescriptor {
  label: string;
  variant: ReconciliationStatus;
}

/**
 * Truth table (0022 adds bothSidesCovered as the 4th param, defaulting to
 * true so every existing 3-argument call site/assertion stays valid):
 * - equal counts               -> 'ok' (regardless of settled OR coverage --
 *   this is what stops a quiet, genuinely-zero day flooding the table with
 *   a false "no report" row; only a DISAGREEMENT is gated on coverage)
 * - unequal, !bothSidesCovered -> 'no_source_data' (an absent report makes
 *   the comparison undefined -- checked before settled/needs_review because
 *   "we don't know" must never be confused with "pending" or "confirmed")
 * - unequal, settled=false     -> 'needs_review' (most-recent unsettled day, D+1 hasn't landed yet)
 * - unequal, settled=true      -> 'mismatch' (settled and still unresolved)
 */
export function computeReconciliationStatus(
  billingCount: number,
  verificationCount: number,
  settled: boolean,
  bothSidesCovered: boolean = true,
): ReconciliationStatus {
  if (billingCount === verificationCount) {
    return "ok";
  }
  if (!bothSidesCovered) {
    return "no_source_data";
  }
  return settled ? "mismatch" : "needs_review";
}

/** Which side is short (lower count) when the two disagree, else null. */
export function computeShortSide(
  billingCount: number,
  verificationCount: number,
): ShortSide {
  if (billingCount === verificationCount) return null;
  return billingCount < verificationCount ? "billing" : "verification";
}

/** Maps a status enum to its badge label/variant (UI-SPEC copywriting). */
export function reconciliationStatusToBadge(
  status: ReconciliationStatus,
): ReconciliationBadgeDescriptor {
  switch (status) {
    case "ok":
      return { label: "OK", variant: "ok" };
    case "needs_review":
      return { label: "Needs review", variant: "needs_review" };
    case "mismatch":
      return { label: "Mismatch", variant: "mismatch" };
    case "no_source_data":
      return { label: "No report received", variant: "no_source_data" };
  }
}

/**
 * Maps a status enum to Tailwind row-styling classes (left accent border +
 * subtle background tint) consumed by the reconciliation table rows; mirrors
 * the StatusBadge variant->token mapping so the two signals stay consistent.
 */
export function reconciliationStatusToRowClassName(status: ReconciliationStatus): string {
  switch (status) {
    case "ok":
      return "border-l-4 border-l-[color:var(--success)] bg-[color:var(--success)]/5";
    case "needs_review":
      return "border-l-4 border-l-[color:var(--warning)] bg-[color:var(--warning)]/5";
    case "mismatch":
      return "border-l-4 border-l-destructive bg-destructive/5";
    case "no_source_data":
      // Neutral, non-alarm treatment (0022) -- reuses exactly the neutral
      // tokens the D-07 gap row already uses. Never destructive/--warning:
      // "we don't know" is not an alarm.
      return "border-l-4 border-l-border border-dashed bg-muted/30";
  }
}
