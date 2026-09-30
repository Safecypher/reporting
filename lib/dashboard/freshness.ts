/**
 * STUB — RED phase placeholder for the TDD cycle (Task 1, tdd="true").
 * Exports compile so lib/dashboard/__tests__/freshness.test.ts can load and
 * run its assertions, but every function is intentionally wrong/unimplemented
 * so the test run fails on the assertions themselves, not on module
 * resolution. Replaced by the real implementation in the GREEN commit.
 */
import type { ReconciliationStatus } from "@/lib/dashboard/reconciliation-status";

export interface SourceOrderEntry {
  reportType: string;
  label: string;
}

export const SOURCE_ORDER: readonly SourceOrderEntry[] = [] as const;

export interface ReportSourceRow {
  report_type: string;
  expected_cadence: "daily-business" | "daily" | "none";
  stale_after_hours: number;
  enabled: boolean;
}

export interface SourceFreshnessRow {
  report_type: string;
  expected_cadence: "daily-business" | "daily" | "none";
  stale_after_hours: number;
  last_covered_day: string | null;
  latest_file_status: string | null;
  latest_file_uploaded_at: string | null;
  stale: boolean;
}

export interface LatestIngestedFileRow {
  report_type: string;
  status: string;
  uploaded_at: string;
}

export interface FreshnessResolution {
  reportType: string;
  label: string;
  badgeStatus: ReconciliationStatus;
  badgeLabel: string;
  caption: string | null;
}

export function formatCoveredDay(_day: string): string {
  return "NOT_IMPLEMENTED";
}

export function formatArrivedAt(_iso: string): string {
  return "NOT_IMPLEMENTED";
}

export function resolveSourceFreshness(
  _source: ReportSourceRow,
  _freshnessRow: SourceFreshnessRow | undefined,
  _latestFile: LatestIngestedFileRow | undefined,
): FreshnessResolution {
  return {
    reportType: "NOT_IMPLEMENTED",
    label: "NOT_IMPLEMENTED",
    badgeStatus: "no_source_data",
    badgeLabel: "NOT_IMPLEMENTED",
    caption: "NOT_IMPLEMENTED",
  };
}

export function buildFreshnessItems(
  _sources: ReportSourceRow[],
  _freshnessRows: SourceFreshnessRow[],
  _latestFiles: LatestIngestedFileRow[],
): FreshnessResolution[] {
  return [];
}
