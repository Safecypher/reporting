import { describe, expect, it } from "vitest";
import {
  alignmentSettingsSchema,
  financialYearSettingsSchema,
  revenueForecastSettingsSchema,
} from "../schema";

const VALIDATION_MESSAGE =
  "Enter a valid day for the selected month (e.g. day 30 is invalid for February).";

describe("financialYearSettingsSchema", () => {
  it("accepts a 6 April financial year start", () => {
    const result = financialYearSettingsSchema.safeParse({
      fyStartMonth: 4,
      fyStartDay: 6,
    });
    expect(result.success).toBe(true);
  });

  it("accepts the 1 January default", () => {
    const result = financialYearSettingsSchema.safeParse({
      fyStartMonth: 1,
      fyStartDay: 1,
    });
    expect(result.success).toBe(true);
  });

  it("rejects day 30 in February with an issue on fyStartDay", () => {
    const result = financialYearSettingsSchema.safeParse({
      fyStartMonth: 2,
      fyStartDay: 30,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "fyStartDay",
      );
      expect(issue?.message).toBe(VALIDATION_MESSAGE);
    }
  });

  it("rejects day 29 in February — validated against a non-leap reference year", () => {
    const result = financialYearSettingsSchema.safeParse({
      fyStartMonth: 2,
      fyStartDay: 29,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "fyStartDay",
      );
      expect(issue?.message).toBe(VALIDATION_MESSAGE);
    }
  });

  it("rejects day 31 in April (April has 30 days)", () => {
    const result = financialYearSettingsSchema.safeParse({
      fyStartMonth: 4,
      fyStartDay: 31,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "fyStartDay",
      );
      expect(issue?.message).toBe(VALIDATION_MESSAGE);
    }
  });

  it("rejects fyStartMonth 0 and 13", () => {
    expect(
      financialYearSettingsSchema.safeParse({ fyStartMonth: 0, fyStartDay: 1 })
        .success,
    ).toBe(false);
    expect(
      financialYearSettingsSchema.safeParse({ fyStartMonth: 13, fyStartDay: 1 })
        .success,
    ).toBe(false);
  });

  it("rejects fyStartDay 0 and non-integer values", () => {
    expect(
      financialYearSettingsSchema.safeParse({ fyStartMonth: 1, fyStartDay: 0 })
        .success,
    ).toBe(false);
    expect(
      financialYearSettingsSchema.safeParse({
        fyStartMonth: 4.5,
        fyStartDay: 6,
      }).success,
    ).toBe(false);
    expect(
      financialYearSettingsSchema.safeParse({
        fyStartMonth: 4,
        fyStartDay: 6.5,
      }).success,
    ).toBe(false);
  });
});

const ALIGNMENT_VALIDATION_MESSAGE = "Enter a whole number of zero or more.";

describe("alignmentSettingsSchema", () => {
  it("accepts the zero default for both fields", () => {
    const result = alignmentSettingsSchema.safeParse({
      baselineOffset: 0,
      toleranceCount: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a positive whole-number pair", () => {
    const result = alignmentSettingsSchema.safeParse({
      baselineOffset: 12500,
      toleranceCount: 3,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative baselineOffset", () => {
    const result = alignmentSettingsSchema.safeParse({
      baselineOffset: -1,
      toleranceCount: 0,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "baselineOffset",
      );
      expect(issue?.message).toBe(ALIGNMENT_VALIDATION_MESSAGE);
    }
  });

  it("rejects a negative toleranceCount", () => {
    const result = alignmentSettingsSchema.safeParse({
      baselineOffset: 0,
      toleranceCount: -3,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "toleranceCount",
      );
      expect(issue?.message).toBe(ALIGNMENT_VALIDATION_MESSAGE);
    }
  });

  it("rejects a non-integer baselineOffset", () => {
    const result = alignmentSettingsSchema.safeParse({
      baselineOffset: 12.5,
      toleranceCount: 0,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "baselineOffset",
      );
      expect(issue?.message).toBe(ALIGNMENT_VALIDATION_MESSAGE);
    }
  });

  it("rejects a non-integer toleranceCount", () => {
    const result = alignmentSettingsSchema.safeParse({
      baselineOffset: 0,
      toleranceCount: 2.5,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "toleranceCount",
      );
      expect(issue?.message).toBe(ALIGNMENT_VALIDATION_MESSAGE);
    }
  });

  it("rejects a missing baselineOffset", () => {
    const result = alignmentSettingsSchema.safeParse({
      toleranceCount: 0,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "baselineOffset",
      );
      expect(issue?.message).toBe(ALIGNMENT_VALIDATION_MESSAGE);
    }
  });

  it("rejects a missing toleranceCount", () => {
    const result = alignmentSettingsSchema.safeParse({
      baselineOffset: 0,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "toleranceCount",
      );
      expect(issue?.message).toBe(ALIGNMENT_VALIDATION_MESSAGE);
    }
  });
});

const REVENUE_FORECAST_VALIDATION_MESSAGE = "Enter a whole number of 1 or more.";

describe("revenueForecastSettingsSchema", () => {
  it("accepts the default of 7", () => {
    const result = revenueForecastSettingsSchema.safeParse({
      minCoveredDays: 7,
    });
    expect(result.success).toBe(true);
  });

  it("accepts the floor value of 1", () => {
    const result = revenueForecastSettingsSchema.safeParse({
      minCoveredDays: 1,
    });
    expect(result.success).toBe(true);
  });

  it("rejects 0 — a projection from zero usable days is not a projection", () => {
    const result = revenueForecastSettingsSchema.safeParse({
      minCoveredDays: 0,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "minCoveredDays",
      );
      expect(issue?.message).toBe(REVENUE_FORECAST_VALIDATION_MESSAGE);
    }
  });

  it("rejects a negative value", () => {
    const result = revenueForecastSettingsSchema.safeParse({
      minCoveredDays: -1,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "minCoveredDays",
      );
      expect(issue?.message).toBe(REVENUE_FORECAST_VALIDATION_MESSAGE);
    }
  });

  it("rejects a non-integer value", () => {
    const result = revenueForecastSettingsSchema.safeParse({
      minCoveredDays: 2.5,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "minCoveredDays",
      );
      expect(issue?.message).toBe(REVENUE_FORECAST_VALIDATION_MESSAGE);
    }
  });

  it("rejects a string value", () => {
    const result = revenueForecastSettingsSchema.safeParse({
      minCoveredDays: "7",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "minCoveredDays",
      );
      expect(issue?.message).toBe(REVENUE_FORECAST_VALIDATION_MESSAGE);
    }
  });

  it("rejects a missing minCoveredDays", () => {
    const result = revenueForecastSettingsSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "minCoveredDays",
      );
      expect(issue?.message).toBe(REVENUE_FORECAST_VALIDATION_MESSAGE);
    }
  });
});
