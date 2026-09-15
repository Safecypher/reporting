import { Suspense } from "react";
import type { Metadata } from "next";

import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { createClient } from "@/lib/supabase/server";
import { FySettingsForm } from "@/components/settings/fy-settings-form";
import { AlignmentSettingsForm } from "@/components/settings/alignment-settings-form";
import { RevenueForecastSettingsForm } from "@/components/settings/revenue-forecast-settings-form";
import { AuditLog, type AuditLogEntry } from "@/components/pricing/audit-log";
import { SettingsFallbackNotice } from "@/components/dashboard/settings-fallback-notice";
import { DEFAULT_FY_START } from "@/lib/settings/fy-settings";
import { fetchAlignmentSettings } from "@/lib/settings/alignment-settings";
import { fetchRevenueForecastSettings } from "@/lib/settings/revenue-forecast-settings";

export const metadata: Metadata = {
  title: "General settings — Safecypher Reporting",
};

type AppSettingsRow = {
  fy_start_month: number;
  fy_start_day: number;
};

type AppSettingsAuditRow = {
  id: number;
  changed_by: string | null;
  changed_at: string;
  summary: string;
};

const AUDIT_ROW_CAP = 50;

function PageHeader() {
  return (
    <div className="flex flex-col gap-2 border-b border-border pb-4">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">
        Settings
      </p>
      <h1 className="text-2xl font-medium text-foreground">
        General settings
      </h1>
      <p className="max-w-2xl text-sm font-light text-muted-foreground">
        Set the financial-year start, dual-source alignment tolerance, and
        revenue forecast threshold used across the dashboard.
      </p>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-border bg-destructive/5 p-12 text-center">
      <svg aria-hidden="true" className="size-8 text-destructive">
        <use href="/icons.svg#alert" />
      </svg>
      <h2 className="text-lg font-medium text-foreground">
        General settings could not be loaded
      </h2>
      <p className="max-w-md text-sm font-light text-muted-foreground">
        Something went wrong reading the financial-year settings or change
        history. Try refreshing the page.
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 border-b border-border pb-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-96" />
      </div>
      <Skeleton className="h-[420px] w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

/**
 * Async Server Component reading app_settings + app_settings_audit via the
 * session-scoped client (RLS: authenticated select-only) so the FY start and
 * its change history are visible to any logged-in user (L-04/D-13).
 *
 * While migration 0023 has not yet been pushed (plan 05-05 does that), both
 * reads will error and this correctly renders ErrorState — that is the
 * honest behaviour and must not be papered over with a fallback.
 */
async function GeneralBody() {
  const supabase = await createClient();

  const [
    settingsResult,
    auditResult,
    alignmentSettingsResult,
    revenueForecastSettingsResult,
  ] = await Promise.all([
    supabase
      .from("app_settings")
      .select("fy_start_month, fy_start_day")
      .eq("id", 1)
      .maybeSingle<AppSettingsRow>(),
    supabase
      .from("app_settings_audit")
      .select("id, changed_by, changed_at, summary")
      .order("changed_at", { ascending: false })
      .limit(50) // AUDIT_ROW_CAP — the E5 overflow backstop
      .returns<AppSettingsAuditRow[]>(),
    // fetchAlignmentSettings never throws (degrades to
    // DEFAULT_ALIGNMENT_SETTINGS on error/absent row) -- it is not part of
    // the settingsResult/auditResult error branch below, matching the
    // existing FY-start ErrorState scope unchanged. Its own `error` field
    // (WR-03) is instead surfaced as a scoped SettingsFallbackNotice inside
    // the Dual-source alignment section below -- a form pre-filled from a
    // failed read is the most dangerous place for that failure to be
    // invisible, since an admin could "confirm" values they never saw.
    fetchAlignmentSettings(supabase),
    // Same rule applies to the revenue-forecast threshold (T-07-10): its
    // read failure must not take the whole page to ErrorState, and must
    // not be silently absorbed into the default either.
    fetchRevenueForecastSettings(supabase),
  ]);
  const { settings: alignmentSettings, error: alignmentSettingsError } = alignmentSettingsResult;
  const {
    settings: revenueForecastSettings,
    error: revenueForecastSettingsError,
  } = revenueForecastSettingsResult;

  if (settingsResult.error || auditResult.error) {
    return (
      <>
        <PageHeader />
        <ErrorState />
      </>
    );
  }

  const settings = settingsResult.data
    ? {
        month: settingsResult.data.fy_start_month,
        day: settingsResult.data.fy_start_day,
      }
    : DEFAULT_FY_START;

  const auditRows = auditResult.data ?? [];
  const entries: AuditLogEntry[] = auditRows.map((row) => ({
    id: row.id,
    actor: row.changed_by ?? "Unknown user",
    summary: row.summary,
    changedAt: row.changed_at,
  }));

  const atCap = auditRows.length === AUDIT_ROW_CAP;

  return (
    <>
      <PageHeader />
      <FySettingsForm fyStartMonth={settings.month} fyStartDay={settings.day} />
      <Separator />
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-medium text-foreground">
            Dual-source alignment
          </h2>
          <p className="max-w-2xl text-sm font-light text-muted-foreground">
            Set the TSYS live-cards baseline offset and the tolerance used to
            judge whether TSYS and Bit Addict agree, on the Alignment page.
          </p>
        </div>
        {/* WR-03: a form pre-filled from a failed settings read is the
            most dangerous place for that failure to be invisible — an
            admin could "confirm" values they never actually saw. */}
        {alignmentSettingsError !== null && <SettingsFallbackNotice />}
        <AlignmentSettingsForm
          baselineOffset={alignmentSettings.baselineOffset}
          toleranceCount={alignmentSettings.toleranceCount}
        />
      </div>
      <Separator />
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-medium text-foreground">
            Revenue forecast
          </h2>
          <p className="max-w-2xl text-sm font-light text-muted-foreground">
            Set how many covered days of data are required before the Revenue
            page shows a month-end or year-end projection.
          </p>
        </div>
        {/* T-07-10: same rule as the alignment section above — a form
            pre-filled from a failed read must never look like a confirmed
            value. */}
        {revenueForecastSettingsError !== null && <SettingsFallbackNotice />}
        <RevenueForecastSettingsForm
          minCoveredDays={revenueForecastSettings.minCoveredDays}
        />
      </div>
      <Separator />
      <div className="flex flex-col gap-2">
        <AuditLog
          entries={entries}
          emptyMessage="No changes yet — using the default financial year (1 January)."
        />
        {atCap && (
          <p className="text-xs font-light text-muted-foreground">
            Showing the {AUDIT_ROW_CAP} most recent changes.
          </p>
        )}
      </div>
    </>
  );
}

export default function GeneralSettingsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <Suspense fallback={<LoadingState />}>
        <GeneralBody />
      </Suspense>
    </div>
  );
}
