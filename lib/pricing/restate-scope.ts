/**
 * G-05-5 gap closure (05-07): the pure resolver deciding whether a pricing-
 * tier save changes the price of days an existing tier set already prices,
 * and over which day range.
 *
 * RED-phase stub (TDD): types are final; `resolveSaveImpact` intentionally
 * throws so `lib/pricing/__tests__/restate-scope.test.ts` fails on real
 * per-test assertions rather than an import/collection crash. Implemented
 * for GREEN in the same plan.
 */

export type TierSetSaveMode =
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly id: string; readonly effectiveFrom: string };

export interface ExistingTierSet {
  readonly id: string;
  readonly effectiveFrom: string;
}

export interface SaveImpact {
  readonly from: string;
  readonly through: string | null;
  readonly supersedes: string | null;
}

export function resolveSaveImpact(
  _mode: TierSetSaveMode,
  _proposedEffectiveFrom: string,
  _existingTierSets: readonly ExistingTierSet[],
): SaveImpact | null {
  throw new Error("resolveSaveImpact: not implemented (RED phase)");
}
