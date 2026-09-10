import { describe, expect, it } from "vitest";
import { isValidCalendarDate } from "../calendar-date";

// G-05-CR01 (code review WR-01): the guard previously named
// `isValidCalendarDate` in app/(dashboard)/settings/pricing/actions.ts did no
// calendar validation at all — `Date.parse("2026-02-30T00:00:00Z")` returns a
// valid timestamp (JS rolls the impossible day into March), not NaN. These
// tests pin the REPLACEMENT guard's genuine round-trip behaviour, mirroring
// the in-repo precedent at lib/ingestion/file-date.ts:15-22.

describe("isValidCalendarDate", () => {
  it("rejects a day that does not exist in its month (30 Feb)", () => {
    expect(isValidCalendarDate("2026-02-30")).toBe(false);
  });

  it("rejects a day that does not exist in its month (31 Sep)", () => {
    expect(isValidCalendarDate("2026-09-31")).toBe(false);
  });

  it("rejects a day that does not exist in its month (31 Apr)", () => {
    expect(isValidCalendarDate("2026-04-31")).toBe(false);
  });

  it("rejects 29 February in a non-leap year", () => {
    expect(isValidCalendarDate("2026-02-29")).toBe(false);
  });

  it("accepts 29 February in a leap year", () => {
    expect(isValidCalendarDate("2024-02-29")).toBe(true);
  });

  it("rejects an impossible month (13)", () => {
    expect(isValidCalendarDate("2026-13-01")).toBe(false);
  });

  it("rejects an impossible month (00)", () => {
    expect(isValidCalendarDate("2026-00-10")).toBe(false);
  });

  it("rejects an impossible day-of-month (00)", () => {
    expect(isValidCalendarDate("2026-08-00")).toBe(false);
  });

  it("accepts real dates in the project's own data window", () => {
    expect(isValidCalendarDate("2026-08-13")).toBe(true);
    expect(isValidCalendarDate("2026-09-10")).toBe(true);
    expect(isValidCalendarDate("2026-12-31")).toBe(true);
  });

  it("rejects a value with the wrong number of digits", () => {
    expect(isValidCalendarDate("2026-8-13")).toBe(false);
  });

  it("rejects a value with no separators", () => {
    expect(isValidCalendarDate("20260813")).toBe(false);
  });

  it("rejects a full ISO date-time string", () => {
    expect(isValidCalendarDate("2026-08-13T00:00:00Z")).toBe(false);
  });

  it("rejects a non-date string", () => {
    expect(isValidCalendarDate("not-a-date")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isValidCalendarDate("")).toBe(false);
  });
});
