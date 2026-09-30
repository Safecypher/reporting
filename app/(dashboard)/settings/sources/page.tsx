import { Suspense } from "react";
import type { Metadata } from "next";

import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { createClient } from "@/lib/supabase/server";
import { freshnessTable, type ReportSourceRow } from "@/lib/dashboard/freshness";
import { SourceSettingsForm } from "@/components/settings/source-settings-form";
import { AuditLog, type AuditLogEntry } from "@/components/pricing/audit-log";
import { actorLabel, fetchActorEmails } from "@/lib/identity/profiles";

export const metadata: Metadata = {
  title: "Report sources — Safecypher Reporting",
};

type ReportSourcesAuditRow = {
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
        Report sources
      </h1>
      <p className="max-w-2xl text-sm font-light text-muted-foreground">
        Tune how quickly each source is flagged overdue, and when the daily
        freshness check runs — no SQL console required.
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
        Report sources could not be loaded.
      </h2>
      <p className="max-w-md text-sm font-light text-muted-foreground">
        Try refreshing the page.
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
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-[420px] w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

/**
 * Async Server Component reading `report_sources` (all columns) and
 * `report_sources_audit` via the SESSION-SCOPED client (RLS: authenticated
 * select on both, authenticated update on `report_sources` only — see
 * `supabase/migrations/0046_freshness_spine.sql`). Neither table is yet in
 * `types/db.ts` (regeneration is plan 10-06's job after the live apply), so
 * both reads go through `lib/dashboard/freshness.ts`'s `freshnessTable`
 * escape hatch rather than `supabase.from(...)` directly, and rather than a
 * second ad-hoc suppression.
 *
 * Either read failing renders `PageHeader` + `ErrorState` — never a partial
 * page. The `fetchActorEmails` round trip is deliberately a separate,
 * necessary third read (the actor ids aren't known until the audit rows are
 * in hand) whose error is kept OUT of that combined branch: losing an email
 * is not losing a row, so the history still renders with the unresolved
 * fallback rather than taking the whole page to its error state.
 */
async function SourcesBody() {
  const supabase = await createClient();

  const [sourcesResult, auditResult] = await Promise.all([
    freshnessTable(supabase, "report_sources").select("*") as Promise<{
      data: ReportSourceRow[] | null;
      error: { message: string } | null;
    }>,
    freshnessTable(supabase, "report_sources_audit")
      .select("id, changed_by, changed_at, summary")
      .order("changed_at", { ascending: false })
      .limit(AUDIT_ROW_CAP) as Promise<{
      data: ReportSourcesAuditRow[] | null;
      error: { message: string } | null;
    }>,
  ]);

  if (sourcesResult.error || auditResult.error) {
    return (
      <>
        <PageHeader />
        <ErrorState />
      </>
    );
  }

  const sourceRows = sourcesResult.data ?? [];
  const auditRows = auditResult.data ?? [];

  const { emails: actorEmails, error: actorEmailsError } = await fetchActorEmails(
    supabase,
    auditRows.map((row) => row.changed_by),
  );
  if (actorEmailsError) {
    console.error("SourcesBody: fetchActorEmails failed", actorEmailsError);
  }

  const entries: AuditLogEntry[] = auditRows.map((row) => ({
    id: row.id,
    actor: actorLabel(row.changed_by, actorEmails),
    summary: row.summary,
    changedAt: row.changed_at,
  }));

  const atCap = auditRows.length === AUDIT_ROW_CAP;

  return (
    <>
      <PageHeader />

      <div className="flex flex-col gap-3 rounded-lg border border-border p-6">
        <h2 className="text-lg font-medium text-foreground">
          Daily check run time
        </h2>
        {/* fn_set_drain_cron_schedule and app_settings.drain_cron_run_time
            (plan 10-05) are what make this section editable -- until that
            plan lands, this states the current, unchangeable behaviour
            rather than describing 10-05's future work. */}
        <p className="text-sm font-light text-muted-foreground">
          Every source is checked once a day, right after the drain
          finishes. Times are UTC.
        </p>
      </div>

      <Separator />

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-medium text-foreground">Sources</h2>
          <p className="max-w-2xl text-sm font-light text-muted-foreground">
            One row per report type. Changes to a row take effect after you
            save that row.
          </p>
        </div>
        <div className="overflow-x-auto">
          <SourceSettingsForm rows={sourceRows} />
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-2">
        <AuditLog
          entries={entries}
          emptyMessage="No source setting changes yet."
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

export default function SourcesPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <Suspense fallback={<LoadingState />}>
        <SourcesBody />
      </Suspense>
    </div>
  );
}
