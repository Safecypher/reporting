import { Suspense } from "react";
import type { Metadata } from "next";
import { Dropzone } from "@/components/upload/dropzone";
import { UploadsHistoryTable } from "@/components/upload/uploads-history-table";
import { TileErrorBoundary } from "@/components/dashboard/tile-error-boundary";
import {
  FreshnessStripSection,
  FreshnessStripSkeleton,
} from "@/components/dashboard/freshness-strip";
import { createClient } from "@/lib/supabase/server";
import { pushTable } from "@/lib/push/tables";
import { fetchActorEmails } from "@/lib/identity/profiles";
import { mergeHistory, type IngestedFileRow, type RejectionRow } from "@/lib/upload/history";

export const metadata: Metadata = {
  title: "Uploads — Safecypher Reporting",
};

async function UploadsHistory() {
  const supabase = await createClient();

  // Both reads go through `pushTable`'s untyped accessor (09-01): the three
  // provenance columns, the two lease columns (plan 13-04), and the
  // `push_credentials(sender)` embed on `ingested_files`, and
  // `push_rejections` itself, are not yet known to `types/db.ts` — that
  // regeneration is plan 09-05's job, performed after migrations 0040/0041
  // are applied live. Run in parallel; either failing renders the one
  // shared error message below (D-16). `pushTable` returns `any`, so
  // `.returns<T>()` can't be called mid-chain (TS2347: untyped calls may
  // not accept type arguments) — the settled pair is cast instead, the same
  // escape hatch applied at the boundary.
  //
  // `processing_started_at` and `processing_attempts` are this plan's quiet
  // failure mode (T-13-42): PostgREST simply omits a column that isn't
  // asked for, no error anywhere, and every pending row would then resolve
  // as leaseless and read as processing forever. Task 1's widened
  // `IngestedFileRow` turns a missing name here into a type error at the
  // cast below.
  const [uploadsResult, rejectionsResult] = (await Promise.all([
    pushTable(supabase, "ingested_files")
      .select(
        "id, file_name, uploaded_at, uploaded_by, status, rows_accepted, rows_duplicate, rows_rejected, source, source_ref, processing_started_at, processing_attempts, push_credentials(sender)"
      )
      .order("uploaded_at", { ascending: false }),
    pushTable(supabase, "push_rejections")
      .select("id, sender, file_name, reason, rejected_at")
      .order("rejected_at", { ascending: false }),
  ])) as [
    { data: IngestedFileRow[] | null; error: unknown },
    { data: RejectionRow[] | null; error: unknown },
  ];

  if (uploadsResult.error || rejectionsResult.error) {
    return (
      <p className="text-sm font-light text-destructive">
        Uploads could not be loaded. Try refreshing the page.
      </p>
    );
  }

  // A necessary third round trip rather than a fourth Promise.all entry —
  // the uploader ids aren't known until uploadsResult resolves above. Its
  // error deliberately does NOT join the shared error branch above: losing
  // an email is not losing a row, so the table still renders with the
  // unresolved fallback ("Manual — unknown user") rather than the whole
  // page's error state.
  const { emails: uploaderEmails, error: emailsError } = await fetchActorEmails(
    supabase,
    (uploadsResult.data ?? []).map((row) => row.uploaded_by)
  );
  if (emailsError) {
    console.error("UploadsHistory: fetchActorEmails failed", emailsError);
  }

  // One evaluation instant, taken here and used for every row — in the
  // merge's pending-state derivation below AND in the table's caption
  // formatting, so a server render and a later client re-render of the
  // same data cannot disagree about whether a row crossed the stuck
  // threshold. Passed to the client component as an ISO string: a `Date`
  // does not cross the Server/Client Component boundary.
  const asOf = new Date();
  const rows = mergeHistory(
    uploadsResult.data ?? [],
    rejectionsResult.data ?? [],
    uploaderEmails,
    asOf
  );

  return <UploadsHistoryTable rows={rows} asOf={asOf.toISOString()} />;
}

export default function UploadsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex flex-col gap-2 border-b border-border pb-4">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">
          Ingestion
        </p>
        <h1 className="text-2xl font-medium text-foreground">Upload report</h1>
      </div>

      <Dropzone />

      {/* D-17: the same six-source strip as the dashboard home, isolated in
          its own boundary -- the first per-region isolation on this page,
          so a failed freshness read cannot blank the dropzone above it or
          the upload history below it. */}
      <TileErrorBoundary label="Freshness">
        <Suspense fallback={<FreshnessStripSkeleton />}>
          <FreshnessStripSection />
        </Suspense>
      </TileErrorBoundary>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-foreground">Upload history</h2>
        <UploadsHistory />
      </div>
    </div>
  );
}
