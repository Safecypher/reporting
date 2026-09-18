/**
 * WR-08 consumer half (08-05, closing 08-REVIEW.md CR-01 / 08-VERIFICATION.md's
 * WR-08 gap). `resolveEditImpact` (`./restate-scope.ts`) has computed a
 * `futureSupersededBy` field since 08-02 — the set that permanently absorbs
 * the edited set's own former future territory, distinct from the
 * immediately-crossed `supersedes` neighbour. Nothing ever read it: the
 * shipped submit gate in `pricing-tier-form.tsx` decided whether to ALWAYS
 * open the confirmation (regardless of day count, per G-05-CR01) using
 * `impact.supersedes !== null` alone. That single-limb condition is
 * reachable-around, because `futureSupersededBy` can fire while `supersedes`
 * is `null`.
 *
 * The reachable trace (08-REVIEW.md CR-01 / 08-VERIFICATION.md WR-08,
 * reproduced here against the shipped resolver): tier set `y` effective
 * 2026-08-01 exists; the edited set `e`, currently effective 2026-09-01, is
 * backdated to 2026-07-15. `y`'s date is not at-or-before the proposed date,
 * so the crossed-neighbour scan (`atOrBeforeProposed`) never finds it —
 * `supersedes` resolves to `null`. But `y` newly outranks `e`'s proposed
 * date while having been strictly earlier than `e`'s own current date, so
 * `resolveFutureSupersession` correctly reports `futureSupersededBy:
 * "2026-08-01"`. `v_revenue_tier_set_by_day` (`supabase/migrations/0012_v_
 * revenue.sql`) resolves every day's governing tier set by `order by
 * effective_from desc limit 1` — highest `effective_from` not exceeding the
 * day wins, forever — so from 2026-08-01 onward `y` outranks `e` for every
 * day, including every day `e` exclusively owned before the move. A gate
 * that only asks "is `supersedes` set" skips the ALWAYS-confirm branch
 * entirely for this case, and at a zero affected-day count the write
 * completes with no confirmation at all: a silent, permanent transfer of
 * pricing authority. This module restates the gate's question as "did
 * pricing authority move" — reading BOTH limbs — so that reachable-around
 * path no longer exists. See 05-REVIEW.md's Round-5 correction (WR-08's
 * original disclosure requirement) and 08-REVIEW.md's CR-01 (the finding
 * that caught the resolver-computed-but-never-read gap).
 *
 * A pure, DOM-free, React-free module: its ONLY import is a type-only import
 * of `SaveImpact`, erased before Vitest or the bundler sees it, so it can
 * never be affected by alias configuration either way.
 */

import type { SaveImpact } from "./restate-scope";

/**
 * The two named consequences of a pricing-authority move, normalised to
 * `string | null` for both fields. `restate-scope.ts`'s `SaveImpact.
 * futureSupersededBy` is a deliberate 08-02 choice: OPTIONAL (present or
 * absent), never `null`, so that every pre-existing 3-field `toEqual`
 * structural-equality assertion in `restate-scope.test.ts` stayed valid
 * unchanged when the field was added. This is the single place that
 * optional-to-null normalisation happens; the resolver's own choice is
 * preserved, not regressed.
 */
export interface PricingAuthorityMove {
  readonly supersedes: string | null;
  readonly futureSupersededBy: string | null;
}

/**
 * Returns `null` when `impact` is `null`, and `null` when neither limb is
 * present (no pricing-authority move at all). Otherwise returns both limbs.
 */
export function resolvePricingAuthorityMove(
  impact: SaveImpact | null,
): PricingAuthorityMove | null {
  if (impact === null) return null;

  const futureSupersededBy = impact.futureSupersededBy ?? null;

  if (impact.supersedes === null && futureSupersededBy === null) return null;

  return { supersedes: impact.supersedes, futureSupersededBy };
}

/**
 * `edit-supersede` now covers movement of pricing authority in EITHER
 * direction — crossing a neighbour, permanently surrendering future
 * territory to one, or both at once. The plain `edit` variant is reserved
 * strictly for an edit that moves no authority at all and only restates its
 * own days.
 */
export type RestateGateDecision =
  | { readonly kind: "save-immediately" }
  | {
      readonly kind: "confirm";
      readonly variant: "edit" | "edit-supersede" | "create-supersede";
      readonly move: PricingAuthorityMove | null;
    };

/**
 * The gate itself: "did pricing authority move", not "is the crossed-
 * neighbour field set". When `move` is non-null, ALWAYS returns a `confirm`
 * decision — unconditionally, without ever reading `restatedDays` — because
 * conditioning the always-confirm guarantee on activity days is exactly the
 * mistake (G-05-CR01, and now WR-08's sibling) that let a silent transfer of
 * pricing authority through. When `move` is null, a zero day count saves
 * immediately and anything else opens the plain `edit` confirmation.
 */
export function resolveRestateGate(
  modeKind: "create" | "edit",
  impact: SaveImpact,
  restatedDays: number,
): RestateGateDecision {
  const move = resolvePricingAuthorityMove(impact);

  if (move !== null) {
    return {
      kind: "confirm",
      variant: modeKind === "create" ? "create-supersede" : "edit-supersede",
      move,
    };
  }

  if (restatedDays === 0) {
    return { kind: "save-immediately" };
  }

  return { kind: "confirm", variant: "edit", move: null };
}

export interface RestateDialogCopy {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
}

export interface BuildRestateDialogCopyInput {
  readonly variant: "edit" | "edit-supersede" | "create-supersede";
  readonly days: number;
  readonly proposedEffectiveFrom: string | null;
  readonly supersedes: string | null;
  readonly futureSupersededBy: string | null;
}

/**
 * Builds the restate-confirmation dialog's copy for all three variants.
 * The `create-supersede` and plain `edit` bodies are moved here VERBATIM
 * from `pricing-tier-form.tsx` — same wording, same day pluralisation, same
 * confirm labels, same closing sentence — they are a shipped Copywriting
 * Contract (05-UI-SPEC.md), not a rewrite. The `edit-supersede` body is
 * composed from sentences so all three limb shapes (crossed-neighbour only,
 * far-future only, both) read naturally and disclose every consequence.
 */
export function buildRestateDialogCopy(input: BuildRestateDialogCopyInput): RestateDialogCopy {
  const { variant, days, proposedEffectiveFrom, supersedes, futureSupersededBy } = input;
  const dayWord = days === 1 ? "day" : "days";

  if (variant === "create-supersede") {
    return {
      title: "Add a new tier set and supersede the current rates?",
      body:
        days > 0
          ? `This creates a new tier set effective ${proposedEffectiveFrom}. From that date it replaces the tier set effective ${supersedes}, including ${days} ${dayWord} already recorded, whose revenue will be restated. This is recorded in the change history.`
          : `This creates a new tier set effective ${proposedEffectiveFrom}. From that date it replaces the tier set effective ${supersedes} for all revenue. No day recorded so far changes. This is recorded in the change history.`,
      confirmLabel: days > 0 ? "Add tier set and restate revenue" : "Add tier set",
    };
  }

  if (variant === "edit-supersede") {
    const sentences: string[] = [];

    if (supersedes !== null) {
      sentences.push(
        `Moving this tier set to ${proposedEffectiveFrom} makes it price days currently priced by the tier set effective ${supersedes}.`,
      );
    }

    if (futureSupersededBy !== null) {
      sentences.push(
        supersedes !== null
          ? `It also gives up every day from ${futureSupersededBy} onward to the tier set effective ${futureSupersededBy}, permanently — including days this tier set prices today.`
          : `Moving this tier set to ${proposedEffectiveFrom} gives up every day from ${futureSupersededBy} onward to the tier set effective ${futureSupersededBy}, permanently — including days this tier set prices today.`,
      );
    }

    sentences.push(
      days > 0
        ? `This restates ${days} ${dayWord} already recorded — past figures shown for that period will change.`
        : "No day recorded so far changes.",
    );
    sentences.push("This is recorded in the change history.");

    const title =
      supersedes !== null && futureSupersededBy !== null
        ? "Save changes and move pricing between tier sets?"
        : futureSupersededBy !== null
          ? "Save changes and hand this tier set's later days to another tier set?"
          : "Save changes and take over pricing from another tier set?";

    return {
      title,
      body: sentences.join(" "),
      confirmLabel: days > 0 ? "Save and restate revenue" : "Save changes",
    };
  }

  // Plain "edit" — D-18/P-04 verbatim.
  return {
    title: "Save changes to pricing tiers?",
    body: `This will restate revenue for ${days} ${dayWord}. Past figures shown for that period will change to reflect the corrected rates. This is recorded in the change history.`,
    confirmLabel: "Save and restate revenue",
  };
}
