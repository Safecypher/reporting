import { describe, expect, it } from "vitest";
import {
  alignmentSettingsSchema,
  drainRunTimeSchema,
  financialYearSettingsSchema,
  reportSourceSettingsSchema,
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

// ---------------------------------------------------------------------------
// reportSourceSettingsSchema (Phase 10 Plan 4, FRESH-05/D-13)
// ---------------------------------------------------------------------------
// `reportType` is a closed enum mirroring the six migration-seeded
// `report_sources` rows / `SOURCE_ORDER` in lib/dashboard/freshness.ts -- it
// is the allowlist that stops a forged seventh source ever being addressed
// by the Server Action. `staleAfterHours`'s floor is 1, not 0 (unlike
// alignmentSettingsSchema), and every rejection on it carries the identical
// Copywriting Contract message so the form never branches on error type.

const REPORT_SOURCE_STALE_HOURS_MESSAGE =
  "Enter a whole number of hours greater than 0.";

const VALID_REPORT_SOURCE_INPUT = {
  reportType: "verification" as const,
  expectedCadence: "daily-business" as const,
  staleAfterHours: 24,
  enabled: true,
};

describe("reportSourceSettingsSchema", () => {
  it.each([
    "verification",
    "billing",
    "dcvv",
    "card-inventory",
    "removed-cards",
    "apigee-stats",
  ])("accepts the canonical reportType %s", (reportType) => {
    const result = reportSourceSettingsSchema.safeParse({
      ...VALID_REPORT_SOURCE_INPUT,
      reportType,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a forged seventh reportType -- the enum is the allowlist", () => {
    const result = reportSourceSettingsSchema.safeParse({
      ...VALID_REPORT_SOURCE_INPUT,
      reportType: "forged-source",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "reportType",
      );
      expect(issue).toBeDefined();
    }
  });

  it.each(["daily-business", "daily", "none"])(
    "accepts the expectedCadence value %s",
    (expectedCadence) => {
      const result = reportSourceSettingsSchema.safeParse({
        ...VALID_REPORT_SOURCE_INPUT,
        expectedCadence,
      });
      expect(result.success).toBe(true);
    },
  );

  it("rejects an unknown expectedCadence", () => {
    const result = reportSourceSettingsSchema.safeParse({
      ...VALID_REPORT_SOURCE_INPUT,
      expectedCadence: "hourly",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "expectedCadence",
      );
      expect(issue).toBeDefined();
    }
  });

  it("accepts the staleAfterHours floor value of 1", () => {
    const result = reportSourceSettingsSchema.safeParse({
      ...VALID_REPORT_SOURCE_INPUT,
      staleAfterHours: 1,
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ["0", 0],
    ["a negative value", -1],
    ["a non-integer value", 2.5],
    ["a string value", "24"],
  ])("rejects staleAfterHours of %s with the identical message", (_label, staleAfterHours) => {
    const result = reportSourceSettingsSchema.safeParse({
      ...VALID_REPORT_SOURCE_INPUT,
      staleAfterHours,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "staleAfterHours",
      );
      expect(issue?.message).toBe(REPORT_SOURCE_STALE_HOURS_MESSAGE);
    }
  });

  it("rejects a non-boolean enabled value", () => {
    const result = reportSourceSettingsSchema.safeParse({
      ...VALID_REPORT_SOURCE_INPUT,
      enabled: "true",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "enabled",
      );
      expect(issue).toBeDefined();
    }
  });

  it("rejects missing fields", () => {
    const result = reportSourceSettingsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// drainRunTimeSchema (Phase 10 Plan 5, FRESH-05/D-14)
// ---------------------------------------------------------------------------
// A regex on the HH:mm string rather than a coerced Date -- the schema
// comment states a Date coercion would silently introduce a timezone
// conversion, so this suite also pins that the parsed value stays the same
// five-character string rather than becoming a Date.

const DRAIN_RUN_TIME_MESSAGE = "Enter a time as HH:mm, 24-hour.";

describe("drainRunTimeSchema", () => {
  it.each(["00:00", "16:00", "23:59"])(
    "accepts the boundary time %s",
    (runTime) => {
      const result = drainRunTimeSchema.safeParse({ runTime });
      expect(result.success).toBe(true);
    },
  );

  it("keeps the value the same five-character string through parse -- no Date coercion", () => {
    const result = drainRunTimeSchema.safeParse({ runTime: "16:00" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.runTime).toBe("16:00");
      expect(typeof result.data.runTime).toBe("string");
    }
  });

  it.each([
    "24:00",
    "23:60",
    "9:05",
    "16:00:00",
    "",
  ])("rejects %s with the documented message", (runTime) => {
    const result = drainRunTimeSchema.safeParse({ runTime });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "runTime",
      );
      expect(issue?.message).toBe(DRAIN_RUN_TIME_MESSAGE);
    }
  });

  it("rejects a non-string runTime", () => {
    const result = drainRunTimeSchema.safeParse({ runTime: 1600 });
    expect(result.success).toBe(false);
  });
});
