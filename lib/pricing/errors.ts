/**
 * Pricing tier-set error mapping — extracted from
 * `app/(dashboard)/settings/pricing/actions.ts` (05-07, closing 05-UAT.md
 * gap G-05-5 missing item 3 / WR-01).
 *
 * A PLAIN module — no `"use server"` directive, no Supabase/Next imports —
 * mirroring `lib/settings/errors.ts` (05-06): a `"use server"` module may
 * only export async functions, so a synchronous mapper defined inside the
 * Server Action could never be imported by a test.
 *
 * The ONLY behavioural change in this extraction: the effective_from
 * collision result now carries tone `warning` (previously rendered
 * destructive red) and names both recovery routes. Every other mapped
 * result keeps its copy and tone verbatim — in particular the data-window
 * blocked copy (D-19) is untouched in both wording and tone, because it
 * reports a guard refusing a write, not a rejected form value.
 */

export type PricingErrorTone = "warning" | "error";

export interface PricingErrorResult {
  readonly tone: PricingErrorTone;
  readonly message: string;
}

export const PRICING_GENERIC_SAVE_ERROR =
  "Could not save pricing tiers — please check the values and try again.";

export const PRICING_GENERIC_DELETE_ERROR =
  "Could not delete the pricing tier set — please try again.";

/**
 * D-17/D-19: maps the data-window coverage guard's `check_violation` — new
 * in 0025, raised by both `save_pricing_tier_set` (an edit that backdates
 * or removes coverage) and `delete_pricing_tier_set` — to the UI-SPEC's
 * exact blocked-delete copy. The guard's underlying message differs
 * slightly by call site (`save_pricing_tier_set: this change would leave...`
 * vs `delete_pricing_tier_set: this is the only tier set...`), but the
 * user-facing consequence is identical: a write that would leave 2026-08-13
 * uncovered.
 */
export const PRICING_DATA_WINDOW_BLOCKED =
  "This is the only tier set covering the data window (from 13 Aug 2026). Add a replacement before deleting this one.";

/**
 * G-05-5 (05-07): re-toned from destructive red to warning, and now names
 * the recovery path instead of dead-ending the user.
 */
export const PRICING_DUPLICATE_EFFECTIVE_FROM =
  "A pricing tier set already exists for this date. Select it in the Tier set list to edit it, or choose a different date.";

export const PRICING_ALREADY_DELETED =
  "That pricing tier set no longer exists — it may have already been deleted.";

export const PRICING_TIER_CONTIGUITY_ERROR =
  "Tiers must be contiguous and in ascending order, ending with a single open-ended tier — check the thresholds and try again.";

function isDataWindowCoverageError(rawMessage: string): boolean {
  return (
    rawMessage.includes("would leave the data window") ||
    rawMessage.includes("is the only tier set covering the data window")
  );
}

/**
 * Maps a raw Postgres/PostgREST error message from `save_pricing_tier_set`
 * to safe, user-facing copy plus a tone (WR-01: raw constraint/table names
 * must never reach the client). The detailed message is always logged
 * server-side by the caller before this is invoked.
 */
export function mapPricingSaveError(rawMessage: string): PricingErrorResult {
  if (rawMessage.includes("pricing_tier_sets_effective_from_key")) {
    return { tone: "warning", message: PRICING_DUPLICATE_EFFECTIVE_FROM };
  }
  if (isDataWindowCoverageError(rawMessage)) {
    return { tone: "error", message: PRICING_DATA_WINDOW_BLOCKED };
  }
  if (rawMessage.includes("no pricing tier set found for id")) {
    return { tone: "error", message: PRICING_ALREADY_DELETED };
  }
  if (
    rawMessage.includes("open-ended") ||
    rawMessage.includes("contiguous tier_order") ||
    rawMessage.includes("ascending upper_bound")
  ) {
    return { tone: "error", message: PRICING_TIER_CONTIGUITY_ERROR };
  }
  return { tone: "error", message: PRICING_GENERIC_SAVE_ERROR };
}

/**
 * Maps a raw Postgres error from `delete_pricing_tier_set` to safe,
 * user-facing copy plus a tone — mirrors `mapPricingSaveError` above.
 * `deletePricingTierSet` discards the tone (its return shape stays
 * string-only, D-19 non-regression) and keeps `--destructive` styling for
 * every delete-path message unconditionally, since delete is a deletion
 * regardless of which guard rejected it.
 */
export function mapPricingDeleteError(rawMessage: string): PricingErrorResult {
  if (isDataWindowCoverageError(rawMessage)) {
    return { tone: "error", message: PRICING_DATA_WINDOW_BLOCKED };
  }
  if (rawMessage.includes("no pricing tier set found for id")) {
    return { tone: "error", message: PRICING_ALREADY_DELETED };
  }
  return { tone: "error", message: PRICING_GENERIC_DELETE_ERROR };
}
