/**
 * Freshness precedence resolver (FRESH-01/FRESH-02/FRESH-03, UI-SPEC binding
 * precedence rule). No network/DOM/clock access except the single exported
 * read function (`fetchFreshnessStripData`) -- everything else here is pure
 * and safe to unit test. Resolves each of the six sources independently in
 * this fixed precedence: Disabled > Failed to parse > Overdue > Current >
 * No report received. See lib/dashboard/__tests__/freshness.test.ts.
 *
 * `SOURCE_ORDER` is the single source of both display order AND copy for the
 * six sources -- nothing else in the codebase re-lists them.
 */
import type { createClient } from "@/lib/supabase/server";
import type { ReconciliationStatus } from "@/lib/dashboard/reconciliation-status";

export interface SourceOrderEntry {
  reportType: string;
  label: string;
}

export const SOURCE_ORDER: readonly SourceOrderEntry[] = [
  { reportType: "verification", label: "Verification" },
  { reportType: "billing", label: "Billing" },
  { reportType: "dcvv", label: "DCVV" },
  { reportType: "card-inventory", label: "Card inventory" },
  { reportType: "removed-cards", label: "Removed cards" },
  { reportType: "apigee-stats", label: "APIGEE stats" },
] as const;

/** Mirrors `report_sources`' column names exactly. */
export interface ReportSourceRow {
  report_type: string;
  expected_cadence: "daily-business" | "daily" | "none";
  stale_after_hours: number;
  enabled: boolean;
}

/** Mirrors `v_source_freshness`'s emitted column names exactly (one row per
 * ENABLED source only -- a disabled source has no row here at all; the UI
 * layer resolves that case from `ReportSourceRow.enabled` instead). */
export interface SourceFreshnessRow {
  report_type: string;
  expected_cadence: "daily-business" | "daily" | "none";
  stale_after_hours: number;
  last_covered_day: string | null;
  latest_file_status: string | null;
  latest_file_uploaded_at: string | null;
  stale: boolean;
}

/** The latest `ingested_files` row for one report type -- derived from
 * `SourceFreshnessRow.latest_file_status`/`latest_file_uploaded_at` by
 * `fetchFreshnessStripData`, not a separate database read. */
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

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * "Last covered {Ddd D Mon}" date half, e.g. "Fri 25 Sep". Deliberately
 * built from `getUTCDay`/`getUTCDate`/`getUTCMonth` rather than
 * `toLocaleDateString(..., { timeZone: "UTC" })` -- the latter is still
 * host-timezone-independent, but this project's Node/ICU combination
 * renders the short-month token as "Sept", not "Sep" (verified live this
 * session), which would silently fail every caption assertion in this
 * file's own test suite. A hand-rolled UTC-field lookup has zero ICU/host
 * dependency at all, which is a stronger guarantee than the pinned
 * `timeZone: "UTC"` option gives, not a weaker one.
 */
export function formatCoveredDay(day: string): string {
  // Bare ISO date strings (`YYYY-MM-DD`) parse as UTC midnight per the
  // ECMA-262 Date Time String Format -- no explicit `T00:00:00Z` needed.
  const d = new Date(day);
  return `${WEEKDAY_LABELS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_LABELS[d.getUTCMonth()]}`;
}

/** "Arrived {Ddd D Mon, HH:mm}", e.g. "Sat 26 Sep, 08:14". Same UTC-field
 * approach as `formatCoveredDay`, for the same reason. */
export function formatArrivedAt(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${WEEKDAY_LABELS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_LABELS[d.getUTCMonth()]}, ${hh}:${mm}`;
}

function sourceLabel(reportType: string): string {
  return SOURCE_ORDER.find((s) => s.reportType === reportType)?.label ?? reportType;
}

/**
 * UI-SPEC binding precedence, evaluated in this exact order per source:
 * 1. `enabled === false` -> Disabled, regardless of any coverage/failure fact.
 * 2. latest ingested_files status === 'failed' -> Failed to parse, regardless
 *    of whether an older covered day is still within threshold.
 * 3. `stale === true` -> Overdue.
 * 4. a non-null covered day -> Current.
 * 5. otherwise -> No report received (no caption -- never a fabricated date).
 */
export function resolveSourceFreshness(
  source: ReportSourceRow,
  freshnessRow: SourceFreshnessRow | undefined,
  latestFile: LatestIngestedFileRow | undefined,
): FreshnessResolution {
  const reportType = source.report_type;
  const label = sourceLabel(reportType);

  if (source.enabled === false) {
    return {
      reportType,
      label,
      badgeStatus: "no_source_data",
      badgeLabel: "Disabled",
      caption: "Monitoring off",
    };
  }

  if (latestFile?.status === "failed") {
    return {
      reportType,
      label,
      badgeStatus: "mismatch",
      badgeLabel: "Failed to parse",
      caption: `Arrived ${formatArrivedAt(latestFile.uploaded_at)}`,
    };
  }

  if (freshnessRow?.stale === true) {
    return {
      reportType,
      label,
      badgeStatus: "needs_review",
      badgeLabel: "Overdue",
      caption: freshnessRow.last_covered_day
        ? `Last covered ${formatCoveredDay(freshnessRow.last_covered_day)}`
        : null,
    };
  }

  if (freshnessRow?.last_covered_day) {
    return {
      reportType,
      label,
      badgeStatus: "ok",
      badgeLabel: "Current",
      caption: `Last covered ${formatCoveredDay(freshnessRow.last_covered_day)}`,
    };
  }

  return {
    reportType,
    label,
    badgeStatus: "no_source_data",
    badgeLabel: "No report received",
    caption: null,
  };
}

/** Maps `SOURCE_ORDER` over the three input arrays so the output is always
 * six items in the fixed canonical order, whatever order the rows arrived
 * in. A source absent from `sources` (should never happen -- `report_sources`
 * is migration-seeded with all six rows) still renders its slot rather than
 * being omitted or throwing. */
export function buildFreshnessItems(
  sources: ReportSourceRow[],
  freshnessRows: SourceFreshnessRow[],
  latestFiles: LatestIngestedFileRow[],
): FreshnessResolution[] {
  const sourceByType = new Map(sources.map((s) => [s.report_type, s]));
  const freshnessByType = new Map(freshnessRows.map((r) => [r.report_type, r]));
  const latestFileByType = new Map(latestFiles.map((f) => [f.report_type, f]));

  return SOURCE_ORDER.map(({ reportType, label }) => {
    const source = sourceByType.get(reportType);
    if (!source) {
      return {
        reportType,
        label,
        badgeStatus: "no_source_data" as const,
        badgeLabel: "No report received",
        caption: null,
      };
    }
    return resolveSourceFreshness(
      source,
      freshnessByType.get(reportType),
      latestFileByType.get(reportType),
    );
  });
}

export interface FreshnessStripData {
  items: FreshnessResolution[];
  stuckCount: number;
  stuckSince: string | null;
  error: unknown;
}

/**
 * Single documented untyped-table/view accessor for `report_sources`,
 * `v_source_freshness` and `alert_runs` -- `types/db.ts` does not yet know
 * these three objects, since a subagent executor in this project has no
 * live Supabase MCP access to apply
 * `supabase/migrations/0046_freshness_spine.sql` and regenerate types (that
 * happens in plan 10-06). Mirrors the existing untyped-table escape hatch
 * `pushTable` in `lib/push/tables.ts`, contained to this one file so every
 * read of these three objects goes through a single documented suppression
 * rather than four scattered ones. Plan 10-06's type regeneration is what
 * retires this function.
 */
function freshnessTable(
  client: Awaited<ReturnType<typeof createClient>>,
  table: string,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (client as any).from(table);
}

type RawSourceFreshnessRow = SourceFreshnessRow;
type RawAlertRunRow = { inbox_stuck_count: number; inbox_oldest_stuck_at: string | null };

/**
 * Reads `report_sources`, `v_source_freshness` and the latest `alert_runs`
 * row in one `Promise.all`, returning `{ items, stuckCount, stuckSince,
 * error }`. `latestFiles` (for the precedence resolver above) is derived
 * from `v_source_freshness`'s own `latest_file_status`/
 * `latest_file_uploaded_at` columns -- no separate `ingested_files` read.
 * `stuckCount`/`stuckSince` come from the most recent `alert_runs` row; with
 * no rows at all they are `0`/`null` and the strip's sentence line does not
 * render.
 */
export async function fetchFreshnessStripData(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<FreshnessStripData> {
  const [sourcesResult, freshnessResult, alertRunResult] = (await Promise.all([
    freshnessTable(supabase, "report_sources").select(
      "report_type, expected_cadence, stale_after_hours, enabled",
    ),
    freshnessTable(supabase, "v_source_freshness").select(
      "report_type, expected_cadence, stale_after_hours, last_covered_day, latest_file_status, latest_file_uploaded_at, stale",
    ),
    freshnessTable(supabase, "alert_runs")
      .select("inbox_stuck_count, inbox_oldest_stuck_at")
      .order("run_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])) as [
    { data: ReportSourceRow[] | null; error: unknown },
    { data: RawSourceFreshnessRow[] | null; error: unknown },
    { data: RawAlertRunRow | null; error: unknown },
  ];

  const error = sourcesResult.error ?? freshnessResult.error ?? alertRunResult.error ?? null;

  const sources = sourcesResult.data ?? [];
  const freshnessRows = freshnessResult.data ?? [];
  const latestFiles: LatestIngestedFileRow[] = freshnessRows
    .filter(
      (row): row is RawSourceFreshnessRow & { latest_file_status: string; latest_file_uploaded_at: string } =>
        row.latest_file_status !== null && row.latest_file_uploaded_at !== null,
    )
    .map((row) => ({
      report_type: row.report_type,
      status: row.latest_file_status,
      uploaded_at: row.latest_file_uploaded_at,
    }));

  const items = buildFreshnessItems(sources, freshnessRows, latestFiles);

  return {
    items,
    stuckCount: alertRunResult.data?.inbox_stuck_count ?? 0,
    stuckSince: alertRunResult.data?.inbox_oldest_stuck_at ?? null,
    error,
  };
}
