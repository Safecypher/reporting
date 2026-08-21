import { z } from "zod";

// Single source of truth for pricing-tier-set validation, imported by BOTH
// the client form (03-02 react-hook-form) and the server action (03-02
// savePricingTierSet) -- per Next.js Server Actions guidance, client-side
// validation is UX-only and the server must always re-validate untrusted
// input against this same schema.
//
// Enforces the contiguity/ordering rule the marginal-bracket revenue SQL
// (03-03+) cannot self-detect (03-RESEARCH.md Pitfall 5): overlapping or
// gapped tier bounds would silently mis-price the gap/overlap region rather
// than error, so this schema is the only place that guarantees "contiguous,
// ascending, single open-ended top tier."

const tierSchema = z.object({
  upperBound: z.number().int().positive().nullable(),
  rate: z.number().nonnegative(),
});

export const pricingTierSetSchema = z
  .object({
    effectiveFrom: z.string(), // ISO date, e.g. "2026-08-13"
    resetWindow: z.enum(["monthly", "quarterly", "none"]),
    tiers: z
      .array(tierSchema)
      .min(1, "Add at least one tier before saving."),
  })
  .superRefine((data, ctx) => {
    const { tiers } = data;
    if (tiers.length === 0) {
      // Already reported by .min() above; avoid a duplicate/confusing
      // contiguity error on top of the empty-array error.
      return;
    }

    let previousUpperBound = 0;
    let contiguityViolated = false;

    tiers.forEach((tier, index) => {
      const isLastTier = index === tiers.length - 1;

      // Only the LAST tier may have a NULL (open-ended) upper bound.
      if (tier.upperBound === null && !isLastTier) {
        contiguityViolated = true;
        return;
      }

      // CR-01: the LAST tier MUST be open-ended (upperBound === null) so
      // every verification volume above the highest configured bracket is
      // still priced. A fully-bounded tier set silently drops all revenue
      // above the top tier (v_revenue_by_tier's inner join against
      // pricing_tiers has no row to match that volume).
      if (isLastTier && tier.upperBound !== null) {
        ctx.addIssue({
          code: "custom",
          message:
            "The last tier must be open-ended (no upper bound) so every verification is priced.",
          path: ["tiers", index, "upperBound"],
        });
      }

      // All non-null upper bounds must be strictly increasing in array
      // order -- this single check catches BOTH overlap (a bound <= the
      // previous bound) and, when combined across the whole array, a gap
      // is a modelling choice this schema does not need to detect since
      // marginal SQL treats "no gap allowed" as "strictly ascending only";
      // any non-ascending value is rejected here.
      if (tier.upperBound !== null) {
        if (tier.upperBound <= previousUpperBound) {
          contiguityViolated = true;
          return;
        }
        previousUpperBound = tier.upperBound;
      }
    });

    if (contiguityViolated) {
      ctx.addIssue({
        code: "custom",
        message:
          "Tiers must be contiguous and in ascending order — check the thresholds and try again.",
        path: ["tiers"],
      });
    }
  });

export type PricingTierSetInput = z.infer<typeof pricingTierSetSchema>;
