import type { Metadata } from "next";
import { Dropzone } from "@/components/upload/dropzone";
import { UploadsHistoryTable, type IngestedFileRow } from "@/components/upload/uploads-history-table";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Uploads — Safecypher Reporting",
};

async function UploadsHistory() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ingested_files")
    .select("id, file_name, uploaded_at, uploaded_by, status, rows_accepted, rows_duplicate, rows_rejected")
    .order("uploaded_at", { ascending: false })
    .returns<IngestedFileRow[]>();

  if (error) {
    return (
      <p className="text-sm font-light text-destructive">
        Uploads could not be loaded. Try refreshing the page.
      </p>
    );
  }

  return <UploadsHistoryTable files={data ?? []} />;
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
