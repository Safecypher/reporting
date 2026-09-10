import { describe, expect, it } from "vitest";
import { financialYearSettingsSchema } from "../schema";

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
