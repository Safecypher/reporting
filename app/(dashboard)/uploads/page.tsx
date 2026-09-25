import type { Metadata } from "next";
import { Dropzone } from "@/components/upload/dropzone";
import { UploadsHistoryTable } from "@/components/upload/uploads-history-table";
import { createClient } from "@/lib/supabase/server";
import { pushTable } from "@/lib/push/tables";
import { mergeHistory, type IngestedFileRow, type RejectionRow } from "@/lib/upload/history";

export const metadata: Metadata = {
  title: "Uploads — Safecypher Reporting",
};

async function UploadsHistory() {
  const supabase = await createClient();

  // Both reads go through `pushTable`'s untyped accessor (09-01): the three
  // provenance columns and the `push_credentials(sender)` embed on
  // `ingested_files`, and `push_rejections` itself, are not yet known to
  // `types/db.ts` — that regeneration is plan 09-05's job, performed after
  // migrations 0040/0041 are applied live. Run in parallel; either failing
  // renders the one shared error message below (D-16). `pushTable` returns
  // `any`, so `.returns<T>()` can't be called mid-chain (TS2347: untyped
  // calls may not accept type arguments) — the settled pair is cast instead,
  // the same escape hatch applied at the boundary.
  const [uploadsResult, rejectionsResult] = (await Promise.all([
    pushTable(supabase, "ingested_files")
      .select(
        "id, file_name, uploaded_at, uploaded_by, status, rows_accepted, rows_duplicate, rows_rejected, source, source_ref, push_credentials(sender)"
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

  const rows = mergeHistory(uploadsResult.data ?? [], rejectionsResult.data ?? []);

  return <UploadsHistoryTable rows={rows} />;
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

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-foreground">Upload history</h2>
        <UploadsHistory />
      </div>
    </div>
  );
}
