import { describe, expect, it } from "vitest";

import {
  DATA_WINDOW_START,
  DEFAULT_YEAR_MODE,
  daysInUtcMonth,
  isCurrentUtcMonthPeriod,
  isCurrentUtcYearPeriod,
  isProjectablePeriod,
  monthOptions,
  resolveFinancialYearBounds,
  resolvePeriod,
  serializePeriodParams,
  yearOptions,
  type FinancialYearStart,
  type ResolvedPeriod,
} from "../period";

const CALENDAR_FY: FinancialYearStart = { month: 1, day: 1 };
const APRIL_FY: FinancialYearStart = { month: 4, day: 6 };

describe("resolvePeriod", () => {
  it("D-03 default: empty params resolve to the current UTC month", () => {
    const today = new Date("2026-09-10T12:00:00Z");
    const result = resolvePeriod({}, CALENDAR_FY, today);

    expect(result).toEqual<ResolvedPeriod>({
      scope: "month",
      yearMode: null,
      of: "2026-09",
      start: "2026-09-01",
      end: "2026-10-01",
      label: "September 2026",
    });
  });

  it("resolves ?period=month&of=2026-08 to August 2026", () => {
    const today = new Date("2026-09-10T12:00:00Z");
    const result = resolvePeriod({ period: "month", of: "2026-08" }, CALENDAR_FY, today);

    expect(result.scope).toBe("month");
    expect(result.of).toBe("2026-08");
    expect(result.start).toBe("2026-08-01");
    expect(result.end).toBe("2026-09-01");
    expect(result.label).toBe("August 2026");
  });

  it("handles a month-end rollover (December -> January)", () => {
    const today = new Date("2026-12-15T00:00:00Z");
    const result = resolvePeriod({}, CALENDAR_FY, today);

    expect(result.of).toBe("2026-12");
    expect(result.start).toBe("2026-12-01");
    expect(result.end).toBe("2027-01-01");
  });

  it("resolves a calendar year", () => {
    const today = new Date("2026-09-10T00:00:00Z");
    const result = resolvePeriod({ period: "year", yearMode: "calendar" }, CALENDAR_FY, today);

    expect(result).toEqual<ResolvedPeriod>({
      scope: "year",
      yearMode: "calendar",
      of: "2026",
      start: "2026-01-01",
      end: "2027-01-01",
      label: "2026 (calendar year)",
    });
  });

  it("handles a calendar-year-end rollover (a past year within the data window)", () => {
    const today = new Date("2027-01-01T00:00:00Z");
    const result = resolvePeriod({ period: "year", of: "2026" }, CALENDAR_FY, today);

    expect(result.start).toBe("2026-01-01");
    expect(result.end).toBe("2027-01-01");
  });

  it("WR-04: the current-year financial year resolves identically regardless of which side of the FY start day `today` falls on", () => {
    // Pre-fix, this exact pair of `today` values resolved to TWO DIFFERENT
    // financial years (FY2025-26 before 6 April, FY2026-27 after it) purely
    // because the clock crossed the FY start day between the two loads —
    // that non-determinism is the WR-04 bug. Post-fix, both resolve to the
    // SAME financial year: the one anchored to 31 December of the current
    // year, exactly like every past year already resolved.
    const beforeBoundary = new Date("2026-03-01T00:00:00Z");
    const afterBoundary = new Date("2026-05-01T00:00:00Z");

    const resultBefore = resolvePeriod(
      { period: "year", yearMode: "financial" },
      APRIL_FY,
      beforeBoundary,
    );
    const resultAfter = resolvePeriod(
      { period: "year", yearMode: "financial" },
      APRIL_FY,
      afterBoundary,
    );

    expect(resultBefore).toEqual(resultAfter);
    expect(resultBefore.of).toBe("2026");
    expect(resultBefore.label).toBe("FY2026-27 (6 Apr 2026 - 5 Apr 2027)");
    expect(resultBefore.end).toBe("2027-04-06");
  });

  it("WR-03: an FY start before the data window clamps `start` to 2026-08-13 — the label keeps the FY's true (unclamped) calendar span", () => {
    const today = new Date("2026-05-01T00:00:00Z");
    const result = resolvePeriod({ period: "year", yearMode: "financial" }, APRIL_FY, today);

    // The raw FY start (6 Apr 2026) predates the 13 Aug 2026 data window.
    expect(result.start).toBe("2026-08-13");
    expect(result.end).toBe("2027-04-06");
    expect(result.label).toBe("FY2026-27 (6 Apr 2026 - 5 Apr 2027)");
  });

  it("WR-03: an FY start on/after the data window resolves its own date, unclamped", () => {
    const today = new Date("2026-10-10T00:00:00Z");
    const result = resolvePeriod(
      { period: "year", yearMode: "financial" },
      { month: 9, day: 1 },
      today,
    );

    expect(result.start).toBe("2026-09-01");
  });

  it("WR-04: the current-year FY option never duplicates the adjacent (previous-year) FY option", () => {
    const today = new Date("2027-05-01T00:00:00Z");
    const currentYearOption = resolvePeriod(
      { period: "year", yearMode: "financial" },
      APRIL_FY,
      today,
    );
    const previousYearOption = resolvePeriod(
      { period: "year", yearMode: "financial", of: "2026" },
      APRIL_FY,
      today,
    );

    expect(currentYearOption.of).toBe("2027");
    expect(previousYearOption.of).toBe("2026");
    expect(currentYearOption.start).not.toBe(previousYearOption.start);
    expect(currentYearOption.end).not.toBe(previousYearOption.end);
  });

  it("clamps a 29 February FY start (rejected at the DB layer, clamped here) — a year safely clear of the data window, isolating the day-in-month clamp from WR-03's floor clamp", () => {
    const today = new Date("2027-06-01T00:00:00Z"); // non-leap year
    const result = resolvePeriod(
      { period: "year", yearMode: "financial" },
      { month: 2, day: 29 },
      today,
    );

    // 2027 is not a leap year — clamp to 28 Feb.
    expect(result.start).toBe("2027-02-28");
  });

  it("clamps a 29 February FY start to the 29th in an actual leap year", () => {
    const today = new Date("2028-06-01T00:00:00Z"); // leap year
    const result = resolvePeriod(
      { period: "year", yearMode: "financial" },
      { month: 2, day: 29 },
      today,
    );

    expect(result.start).toBe("2028-02-29");
  });

  it("clamps a 31-day FY start landing in a 30-day month (April) — a year safely clear of the data window", () => {
    const today = new Date("2027-06-01T00:00:00Z");
    const result = resolvePeriod(
      { period: "year", yearMode: "financial" },
      { month: 4, day: 31 },
      today,
    );

    expect(result.start).toBe("2027-04-30");
  });

  it("keeps a leap-year 29 February inside its own month window", () => {
    const today = new Date("2028-02-29T12:00:00Z");
    const result = resolvePeriod({ period: "month" }, CALENDAR_FY, today);

    expect(result.of).toBe("2028-02");
    expect(result.start).toBe("2028-02-01");
    expect(result.end).toBe("2028-03-01");
  });

  it("falls back to the D-03 default for an unrecognised `period` value", () => {
    const today = new Date("2026-09-10T00:00:00Z");
    const result = resolvePeriod({ period: "quarter" }, CALENDAR_FY, today);

    expect(result.scope).toBe("month");
    expect(result.of).toBe("2026-09");
  });

  it("falls back to the D-03 default for a calendar-invalid `of` (month 13)", () => {
    const today = new Date("2026-09-10T00:00:00Z");
    const result = resolvePeriod({ period: "month", of: "2026-13" }, CALENDAR_FY, today);

    expect(result.of).toBe("2026-09");
  });

  it("falls back to the D-03 default for a future `of`", () => {
    const today = new Date("2026-09-10T00:00:00Z");
    const result = resolvePeriod({ period: "month", of: "2099-01" }, CALENDAR_FY, today);

    expect(result.of).toBe("2026-09");
  });

  it("falls back to the D-03 default for an `of` before the data window", () => {
    const today = new Date("2026-09-10T00:00:00Z");
    const result = resolvePeriod({ period: "month", of: "2020-01" }, CALENDAR_FY, today);

    expect(result.of).toBe("2026-09");
  });

  it("resolves ?period=year with no `of` to the current year", () => {
    const today = new Date("2026-09-10T00:00:00Z");
    const result = resolvePeriod({ period: "year" }, CALENDAR_FY, today);

    expect(result.scope).toBe("year");
    expect(result.of).toBe("2026");
  });

  it("ignores `of` when no `period` is given — uses the D-03 default, not an error", () => {
    const today = new Date("2026-09-10T00:00:00Z");
    const result = resolvePeriod({ of: "2026-08" }, CALENDAR_FY, today);

    expect(result.scope).toBe("month");
    expect(result.of).toBe("2026-09");
  });

  it("resolves ?period=all to an open-ended range from the data window start", () => {
    const today = new Date("2026-09-10T00:00:00Z");
    const result = resolvePeriod({ period: "all" }, CALENDAR_FY, today);

    expect(result).toEqual<ResolvedPeriod>({
      scope: "all",
      yearMode: null,
      of: null,
      start: DATA_WINDOW_START,
      end: null,
      label: "all time",
    });
  });

  it("defaults yearMode to calendar (P-01) when Year is selected with no yearMode", () => {
    const today = new Date("2026-09-10T00:00:00Z");
    const result = resolvePeriod({ period: "year" }, CALENDAR_FY, today);

    expect(result.yearMode).toBe(DEFAULT_YEAR_MODE);
    expect(result.yearMode).toBe("calendar");
  });
});

describe("isCurrentUtcMonthPeriod", () => {
  const today = new Date("2026-09-10T12:00:00Z");

  it("is true for a month-scoped period naming the current UTC month", () => {
    const period = resolvePeriod({ period: "month", of: "2026-09" }, CALENDAR_FY, today);
    expect(isCurrentUtcMonthPeriod(period, today)).toBe(true);
  });

  it("is false for a month-scoped period naming an earlier month", () => {
    const period = resolvePeriod({ period: "month", of: "2026-08" }, CALENDAR_FY, today);
    expect(isCurrentUtcMonthPeriod(period, today)).toBe(false);
  });

  it("is false for a year-scoped period, regardless of today", () => {
    const period = resolvePeriod({ period: "year", of: "2026" }, CALENDAR_FY, today);
    expect(isCurrentUtcMonthPeriod(period, today)).toBe(false);
  });

  it("is false for an all-time period, regardless of today", () => {
    const period = resolvePeriod({ period: "all" }, CALENDAR_FY, today);
    expect(isCurrentUtcMonthPeriod(period, today)).toBe(false);
  });
});

describe("isCurrentUtcYearPeriod", () => {
  const today = new Date("2026-09-10T12:00:00Z");

  it("is true for a calendar year-scoped period naming the current UTC year", () => {
    const period = resolvePeriod(
      { period: "year", yearMode: "calendar", of: "2026" },
      CALENDAR_FY,
      today,
    );
    expect(isCurrentUtcYearPeriod(period, today)).toBe(true);
  });

  it("is true for a financial year-scoped period naming the current UTC year", () => {
    const period = resolvePeriod(
      { period: "year", yearMode: "financial", of: "2026" },
      APRIL_FY,
      today,
    );
    expect(isCurrentUtcYearPeriod(period, today)).toBe(true);
  });

  it("is false for a year-scoped period naming an earlier year", () => {
    const period = resolvePeriod({ period: "year", of: "2026" }, CALENDAR_FY, today);
    const laterToday = new Date("2027-01-15T00:00:00Z");
    expect(isCurrentUtcYearPeriod(period, laterToday)).toBe(false);
  });

  it("is false for a month-scoped period, regardless of today", () => {
    const period = resolvePeriod({ period: "month" }, CALENDAR_FY, today);
    expect(isCurrentUtcYearPeriod(period, today)).toBe(false);
  });

  it("is false for an all-time period, regardless of today", () => {
    const period = resolvePeriod({ period: "all" }, CALENDAR_FY, today);
    expect(isCurrentUtcYearPeriod(period, today)).toBe(false);
  });
});

describe("isProjectablePeriod", () => {
  const today = new Date("2026-09-10T12:00:00Z");

  it("is true for the current month", () => {
    const period = resolvePeriod({ period: "month", of: "2026-09" }, CALENDAR_FY, today);
    expect(isProjectablePeriod(period, today)).toBe(true);
  });

  it("is true for the current year", () => {
    const period = resolvePeriod({ period: "year", of: "2026" }, CALENDAR_FY, today);
    expect(isProjectablePeriod(period, today)).toBe(true);
  });

  it("is false for a past month", () => {
    const period = resolvePeriod({ period: "month", of: "2026-08" }, CALENDAR_FY, today);
    expect(isProjectablePeriod(period, today)).toBe(false);
  });

  it("is false for a past year", () => {
    const period = resolvePeriod({ period: "year", of: "2026" }, CALENDAR_FY, new Date("2027-06-01T00:00:00Z"));
    expect(isProjectablePeriod(period, new Date("2027-06-01T00:00:00Z"))).toBe(false);
  });

  it("is false for the all-time scope, whose end is null", () => {
    const period = resolvePeriod({ period: "all" }, CALENDAR_FY, today);
    expect(period.end).toBeNull();
    expect(isProjectablePeriod(period, today)).toBe(false);
  });

  it("is pure — same period and today always produce the same answer", () => {
    const period = resolvePeriod({ period: "month", of: "2026-09" }, CALENDAR_FY, today);
    expect(isProjectablePeriod(period, today)).toBe(isProjectablePeriod(period, today));
  });
});

describe("daysInUtcMonth", () => {
  it("returns 31 for January", () => {
    expect(daysInUtcMonth(2026, 1)).toBe(31);
  });

  it("returns 28 for February in a non-leap year", () => {
    expect(daysInUtcMonth(2026, 2)).toBe(28);
  });

  it("returns 29 for February in a leap year", () => {
    expect(daysInUtcMonth(2028, 2)).toBe(29);
  });

  it("returns 30 for April", () => {
    expect(daysInUtcMonth(2026, 4)).toBe(30);
  });
});

describe("resolveFinancialYearBounds", () => {
  it("is pure — never touches the wall clock, only the injected `today`", () => {
    const bounds = resolveFinancialYearBounds(APRIL_FY, new Date("2026-03-01T00:00:00Z"));
    expect(bounds.fyLabel).toBe("FY2025-26");
  });
});

describe("monthOptions / yearOptions", () => {
  it("monthOptions is reverse-chronological and hard-capped at the current UTC month", () => {
    const today = new Date("2026-10-05T00:00:00Z");
    const options = monthOptions(today);

    expect(options[0]).toEqual({ value: "2026-10", label: "October 2026" });
    expect(options[options.length - 1]).toEqual({ value: "2026-08", label: "August 2026" });
    expect(options).toHaveLength(3);
  });

  it("yearOptions is reverse-chronological and hard-capped at the current UTC year", () => {
    const today = new Date("2027-01-15T00:00:00Z");
    const options = yearOptions(today);

    expect(options[0]).toEqual({ value: "2027", label: "2027" });
    expect(options[options.length - 1]).toEqual({ value: "2026", label: "2026" });
  });
});

describe("serializePeriodParams round trip (Task 2 behavior)", () => {
  it("serializePeriodParams for a month scope omits yearMode", () => {
    const period: ResolvedPeriod = {
      scope: "month",
      yearMode: null,
      of: "2026-08",
      start: "2026-08-01",
      end: "2026-09-01",
      label: "August 2026",
    };

    expect(serializePeriodParams(period)).toEqual({ period: "month", of: "2026-08" });
  });

  it("serializePeriodParams for a financial year scope includes yearMode", () => {
    const period: ResolvedPeriod = {
      scope: "year",
      yearMode: "financial",
      of: "2026",
      start: "2025-04-06",
      end: "2026-04-06",
      label: "FY2025-26 (6 Apr 2025 - 5 Apr 2026)",
    };

    expect(serializePeriodParams(period)).toEqual({
      period: "year",
      of: "2026",
      yearMode: "financial",
    });
  });

  it("serializePeriodParams for an all-time scope omits both `of` and `yearMode`", () => {
    const period: ResolvedPeriod = {
      scope: "all",
      yearMode: null,
      of: null,
      start: DATA_WINDOW_START,
      end: null,
      label: "all time",
    };

    expect(serializePeriodParams(period)).toEqual({ period: "all" });
  });

  it("round-trips for every scope: resolvePeriod(serializePeriodParams(p)) matches p", () => {
    const today = new Date("2026-09-10T00:00:00Z");

    const cases: ResolvedPeriod[] = [
      resolvePeriod({ period: "month", of: "2026-08" }, CALENDAR_FY, today),
      resolvePeriod({ period: "year", yearMode: "calendar", of: "2026" }, CALENDAR_FY, today),
      resolvePeriod({ period: "year", yearMode: "financial" }, APRIL_FY, today),
      resolvePeriod({ period: "all" }, CALENDAR_FY, today),
    ];

    for (const period of cases) {
      const serialized = serializePeriodParams(period);
      const fyStart = period.yearMode === "financial" ? APRIL_FY : CALENDAR_FY;
      const reresolved = resolvePeriod(serialized, fyStart, today);

      expect(reresolved.scope).toBe(period.scope);
      expect(reresolved.of).toBe(period.of);
      expect(reresolved.start).toBe(period.start);
      expect(reresolved.end).toBe(period.end);
    }
  });
});
