import { describe, expect, it } from "vitest";

import {
  SOURCE_ORDER,
  buildFreshnessItems,
  formatArrivedAt,
  formatCoveredDay,
  resolveSourceFreshness,
  type LatestIngestedFileRow,
  type ReportSourceRow,
  type SourceFreshnessRow,
} from "../freshness";

function source(overrides: Partial<ReportSourceRow> = {}): ReportSourceRow {
  return {
    report_type: "verification",
    expected_cadence: "daily-business",
    stale_after_hours: 12,
    enabled: true,
    ...overrides,
  };
}

function freshnessRow(overrides: Partial<SourceFreshnessRow> = {}): SourceFreshnessRow {
  return {
    report_type: "verification",
    expected_cadence: "daily-business",
    stale_after_hours: 12,
    last_covered_day: null,
    latest_file_status: null,
    latest_file_uploaded_at: null,
    stale: false,
    ...overrides,
  };
}

function latestFile(overrides: Partial<LatestIngestedFileRow> = {}): LatestIngestedFileRow {
  return {
    report_type: "verification",
    status: "done",
    uploaded_at: "2026-09-26T08:14:00Z",
    ...overrides,
  };
}

describe("resolveSourceFreshness", () => {
  it("enabled: false always resolves to Disabled, even with a coverage date AND a failed latest file", () => {
    const result = resolveSourceFreshness(
      source({ enabled: false }),
      freshnessRow({ last_covered_day: "2026-09-25", stale: false }),
      latestFile({ status: "failed" }),
    );
    expect(result.badgeStatus).toBe("no_source_data");
    expect(result.badgeLabel).toBe("Disabled");
    expect(result.caption).toBe("Monitoring off");
  });

  it("latest file status 'failed' resolves to Failed to parse, even when stale is false and a covered day exists", () => {
    const result = resolveSourceFreshness(
      source(),
      freshnessRow({ last_covered_day: "2026-09-25", stale: false }),
      latestFile({ status: "failed", uploaded_at: "2026-09-26T08:14:00Z" }),
    );
    expect(result.badgeStatus).toBe("mismatch");
    expect(result.badgeLabel).toBe("Failed to parse");
    // NOTE: 2026-09-26 is a Saturday (confirmed via getUTCDay()), not the
    // "Fri 26 Sep" the plan's own <behavior> block literally wrote — a
    // date/weekday mismatch in the plan text itself (Rule 1 deviation,
    // documented in 10-01-SUMMARY.md). The formatter derives the weekday
    // from the actual date, so the only correct expectation is "Sat".
    expect(result.caption).toBe("Arrived Sat 26 Sep, 08:14");
  });

  it("latest file status 'pending' falls through to the coverage-based branches (pending is not a failure)", () => {
    const result = resolveSourceFreshness(
      source(),
      freshnessRow({ last_covered_day: "2026-09-25", stale: false }),
      latestFile({ status: "pending" }),
    );
    expect(result.badgeStatus).toBe("ok");
    expect(result.badgeLabel).toBe("Current");
  });

  it("stale: true resolves to Overdue", () => {
    const result = resolveSourceFreshness(
      source(),
      freshnessRow({ last_covered_day: "2026-09-25", stale: true }),
      undefined,
    );
    expect(result.badgeStatus).toBe("needs_review");
    expect(result.badgeLabel).toBe("Overdue");
    expect(result.caption).toBe("Last covered Fri 25 Sep");
  });

  it("stale: false with a covered day resolves to Current", () => {
    const result = resolveSourceFreshness(
      source(),
      freshnessRow({ last_covered_day: "2026-09-26", stale: false }),
      undefined,
    );
    expect(result.badgeStatus).toBe("ok");
    expect(result.badgeLabel).toBe("Current");
    expect(result.caption).toBe("Last covered Sat 26 Sep");
    // 2026-09-26 is a Saturday (getUTCDay() === 6) — see the Rule 1 deviation
    // note above; the caption's weekday must match the actual calendar date.
  });

  it("no coverage, no file at all resolves to No report received with no caption", () => {
    const result = resolveSourceFreshness(source(), freshnessRow(), undefined);
    expect(result.badgeStatus).toBe("no_source_data");
    expect(result.badgeLabel).toBe("No report received");
    expect(result.caption).toBeNull();
  });

  it("no coverage but a 'done' file exists still resolves to No report received, caption null (no fabricated date)", () => {
    const result = resolveSourceFreshness(
      source(),
      freshnessRow({ last_covered_day: null, stale: false }),
      latestFile({ status: "done" }),
    );
    expect(result.badgeStatus).toBe("no_source_data");
    expect(result.badgeLabel).toBe("No report received");
    expect(result.caption).toBeNull();
  });

  it("a missing v_source_freshness row for an ENABLED source resolves to No report received, never throws", () => {
    const result = resolveSourceFreshness(source({ enabled: true }), undefined, undefined);
    expect(result.badgeStatus).toBe("no_source_data");
    expect(result.badgeLabel).toBe("No report received");
    expect(result.caption).toBeNull();
  });
});

describe("SOURCE_ORDER / buildFreshnessItems", () => {
  it("SOURCE_ORDER has exactly six entries in the canonical order", () => {
    expect(SOURCE_ORDER.map((s) => s.reportType)).toEqual([
      "verification",
      "billing",
      "dcvv",
      "card-inventory",
      "removed-cards",
      "apigee-stats",
    ]);
    expect(SOURCE_ORDER.map((s) => s.label)).toEqual([
      "Verification",
      "Billing",
      "DCVV",
      "Card inventory",
      "Removed cards",
      "APIGEE stats",
    ]);
  });

  it("buildFreshnessItems returns six items in canonical order regardless of input row order", () => {
    const sources: ReportSourceRow[] = [
      source({ report_type: "apigee-stats" }),
      source({ report_type: "verification" }),
      source({ report_type: "billing" }),
      source({ report_type: "removed-cards" }),
      source({ report_type: "card-inventory" }),
      source({ report_type: "dcvv" }),
    ];
    const rows: SourceFreshnessRow[] = sources.map((s) =>
      freshnessRow({ report_type: s.report_type, last_covered_day: "2026-09-26", stale: false }),
    );

    const items = buildFreshnessItems(sources, rows, []);

    expect(items.map((i) => i.reportType)).toEqual([
      "verification",
      "billing",
      "dcvv",
      "card-inventory",
      "removed-cards",
      "apigee-stats",
    ]);
  });
});

describe("caption formatters (UTC-anchored)", () => {
  it("formatCoveredDay is UTC-anchored regardless of host timezone", () => {
    expect(formatCoveredDay("2026-09-25")).toBe("Fri 25 Sep");
  });

  it("formatArrivedAt is UTC-anchored regardless of host timezone", () => {
    // 2026-09-26 is a Saturday (getUTCDay() === 6) — see the Rule 1 deviation
    // note in the "Failed to parse" case above.
    expect(formatArrivedAt("2026-09-26T08:14:00Z")).toBe("Sat 26 Sep, 08:14");
  });
});
