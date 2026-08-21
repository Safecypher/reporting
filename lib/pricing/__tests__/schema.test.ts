import { describe, expect, it } from "vitest";
import { pricingTierSetSchema } from "../schema";

const validTierSet = {
  effectiveFrom: "2026-08-13",
  resetWindow: "monthly" as const,
  tiers: [
    { upperBound: 500000, rate: 0.08 },
    { upperBound: null, rate: 0.09 },
  ],
};

describe("pricingTierSetSchema", () => {
  it("accepts a valid 2-tier set", () => {
    const result = pricingTierSetSchema.safeParse(validTierSet);
    expect(result.success).toBe(true);
  });

  it("rejects an empty tiers array", () => {
    const result = pricingTierSetSchema.safeParse({
      ...validTierSet,
      tiers: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Add at least one tier before saving.");
    }
  });

  it("rejects tiers whose upper bounds are not strictly ascending (gap/overlap)", () => {
    const overlapping = {
      ...validTierSet,
      tiers: [
        { upperBound: 500000, rate: 0.08 },
        { upperBound: 400000, rate: 0.09 }, // descending -> overlap
        { upperBound: null, rate: 0.1 },
      ],
    };
    const result = pricingTierSetSchema.safeParse(overlapping);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain(
        "Tiers must be contiguous and in ascending order — check the thresholds and try again.",
      );
    }
  });

  it("rejects a NULL upper_bound on any tier that is not the last tier", () => {
    const nullInMiddle = {
      ...validTierSet,
      tiers: [
        { upperBound: null, rate: 0.08 },
        { upperBound: 500000, rate: 0.09 },
      ],
    };
    const result = pricingTierSetSchema.safeParse(nullInMiddle);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain(
        "Tiers must be contiguous and in ascending order — check the thresholds and try again.",
      );
    }
  });

  it("rejects a closed (non-open-ended) top tier", () => {
    const boundedTop = {
      ...validTierSet,
      tiers: [{ upperBound: 100000, rate: 0.08 }],
    };
    const result = pricingTierSetSchema.safeParse(boundedTop);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain(
        "The last tier must be open-ended (no upper bound) so every verification is priced.",
      );
    }
  });

  it("rejects a negative rate", () => {
    const negativeRate = {
      ...validTierSet,
      tiers: [
        { upperBound: 500000, rate: -0.08 },
        { upperBound: null, rate: 0.09 },
      ],
    };
    const result = pricingTierSetSchema.safeParse(negativeRate);
    expect(result.success).toBe(false);
  });
});
