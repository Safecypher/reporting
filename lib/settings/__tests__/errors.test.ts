import { describe, expect, it } from "vitest";
import {
  friendlyFinancialYearErrorMessage,
  FY_SETTINGS_GENERIC_ERROR,
  FY_SETTINGS_INVALID_DAY_ERROR,
} from "../errors";

// 05-VERIFICATION.md gap 2 / 05-REVIEW WR-01 (FY-01): the live-reproduced
// Postgres text for an impossible day/month pair against project
// gditxlxfdwlvnyhhxybf. This is NOT a 23514 check_violation — make_date()
// itself raises before the CHECK expression is ever evaluated.
const REAL_POSTGRES_MESSAGE = "date field value out of range: 2001-02-30";

describe("friendlyFinancialYearErrorMessage", () => {
  it("maps the real Postgres 22008 text (with date suffix) to the invalid-day copy", () => {
    expect(friendlyFinancialYearErrorMessage(REAL_POSTGRES_MESSAGE)).toBe(
      FY_SETTINGS_INVALID_DAY_ERROR,
    );
  });

  it("maps 'date field value out of range' with no date suffix to the invalid-day copy", () => {
    expect(
      friendlyFinancialYearErrorMessage("date field value out of range"),
    ).toBe(FY_SETTINGS_INVALID_DAY_ERROR);
  });

  it("still maps the constraint-name substring to the invalid-day copy (no regression)", () => {
    expect(
      friendlyFinancialYearErrorMessage(
        'new row for relation "app_settings" violates check constraint "app_settings_fy_start_day_check"',
      ),
    ).toBe(FY_SETTINGS_INVALID_DAY_ERROR);
  });

  it("still maps the make_date substring to the invalid-day copy (no regression)", () => {
    expect(
      friendlyFinancialYearErrorMessage("error calling make_date(2001, 2, 30)"),
    ).toBe(FY_SETTINGS_INVALID_DAY_ERROR);
  });

  it("maps an unrelated error message to exactly the generic copy", () => {
    expect(
      friendlyFinancialYearErrorMessage("permission denied for table app_settings"),
    ).toBe(FY_SETTINGS_GENERIC_ERROR);
  });

  it("maps an empty string to exactly the generic copy", () => {
    expect(friendlyFinancialYearErrorMessage("")).toBe(FY_SETTINGS_GENERIC_ERROR);
  });

  it("never returns anything other than one of the two exported constants, and never leaks raw input", () => {
    const rawMessages = [
      REAL_POSTGRES_MESSAGE,
      "date field value out of range",
      'new row for relation "app_settings" violates check constraint "app_settings_fy_start_day_check"',
      "error calling make_date(2001, 2, 30)",
      "permission denied for table app_settings",
      "",
      // Deliberately includes a table name and a constraint name to prove
      // the mapper never echoes any fragment of its input, regardless of
      // which branch fires.
      'ERROR: connection to server failed; table "app_settings", constraint "app_settings_fy_start_day_check" involved',
    ];

    for (const raw of rawMessages) {
      const result = friendlyFinancialYearErrorMessage(raw);
      expect([FY_SETTINGS_GENERIC_ERROR, FY_SETTINGS_INVALID_DAY_ERROR]).toContain(result);
      if (raw.length > 0) {
        expect(result).not.toContain(raw);
      }
    }
  });
});
