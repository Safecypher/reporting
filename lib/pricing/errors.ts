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
 * RED-phase stub (TDD): the exported constants and mapper signatures are
 * final; both mappers intentionally throw so
 * `lib/pricing/__tests__/errors.test.ts` fails on real per-test assertions
 * rather than an import/collection crash. Implemented for GREEN in the same
 * plan.
 */

export type PricingErrorTone = "warning" | "error";

export interface PricingErrorResult {
  readonly tone: PricingErrorTone;
  readonly message: string;
}

export const PRICING_GENERIC_SAVE_ERROR = "__RED_STUB__";
export const PRICING_GENERIC_DELETE_ERROR = "__RED_STUB__";
export const PRICING_DATA_WINDOW_BLOCKED = "__RED_STUB__";
export const PRICING_DUPLICATE_EFFECTIVE_FROM = "__RED_STUB__";
export const PRICING_ALREADY_DELETED = "__RED_STUB__";
export const PRICING_TIER_CONTIGUITY_ERROR = "__RED_STUB__";

export function mapPricingSaveError(_rawMessage: string): PricingErrorResult {
  throw new Error("mapPricingSaveError: not implemented (RED phase)");
}

export function mapPricingDeleteError(_rawMessage: string): PricingErrorResult {
  throw new Error("mapPricingDeleteError: not implemented (RED phase)");
}
