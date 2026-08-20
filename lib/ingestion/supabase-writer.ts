import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import type { IngestDeps, NormalisedVerificationRow, RejectedRow } from "./types";

/** Private Storage bucket created in the 01-03 migrations (public = false). */
const REPORTS_BUCKET = "reports";

function buildSecretClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error(
      "SUPABASE_SECRET_KEY and NEXT_PUBLIC_SUPABASE_URL must be set for server-side ingestion writes"
    );
  }

  // Server-only client: SUPABASE_SECRET_KEY bypasses RLS and must never be
  // imported into a 'use client' component (T-05-03).
  return createSupabaseClient<Database>(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function storagePath(contentSha256: string, fileName: string): string {
  return `${contentSha256}/${fileName}`;
}

/**
 * Builds the Supabase-backed `IngestDeps` implementation used by the real
 * upload path (`app/api/ingest/route.ts`). Optionally accepts an injected
 * client for tests — production callers should call this with no argument
 * so it builds the secret-key client itself.
 *
 * Stateful per call: `recordFile` stashes the ingested_files row id in a
 * closure variable that `upsertVerifications` reads to satisfy the
 * `source_file_id` FK. This is safe because `ingest()` always calls
 * `recordFile` before `upsertVerifications` for a single file, and a fresh
 * writer is constructed per request (no cross-request sharing).
 */
export function createSupabaseWriter(client?: SupabaseClient<Database>): IngestDeps {
  const supabase = client ?? buildSecretClient();
  let currentFileId: string | null = null;

  return {
    async findFileByHash(sha256) {
      const { data, error } = await supabase
        .from("ingested_files")
        .select("id, uploaded_at")
        .eq("content_sha256", sha256)
        .maybeSingle();

      if (error) throw error;
      return data;
    },

    async recordFile(meta) {
      const path = storagePath(meta.contentSha256, meta.fileName);

      const { error: uploadError } = await supabase.storage
        .from(REPORTS_BUCKET)
        .upload(path, meta.bytes, {
          contentType: "text/csv",
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { data, error } = await supabase
        .from("ingested_files")
        .insert({
          file_name: meta.fileName,
          content_sha256: meta.contentSha256,
          uploaded_by: meta.uploadedBy,
          report_type: meta.reportType,
          storage_path: path,
          status: "pending",
        })
        .select("id")
        .single();

      if (error) throw error;
      currentFileId = data.id;
      return data.id;
    },

    async upsertVerifications(rows: NormalisedVerificationRow[]) {
      if (rows.length === 0) return 0;
      if (!currentFileId) {
        throw new Error("upsertVerifications called before recordFile — no source_file_id available");
      }

      const { data, error } = await supabase
        .from("verifications")
        .upsert(
          rows.map((row) => ({
            created_at: row.created_at,
            raw_created_at: row.raw_created_at,
            external_card_reference: row.external_card_reference,
            cvi2_value: row.cvi2_value,
            duration_ms: row.duration_ms,
            authenticated: row.authenticated,
            source_file_id: currentFileId as string,
          })),
          { onConflict: "row_hash", ignoreDuplicates: true }
        )
        .select("id");

      if (error) throw error;
      return data?.length ?? 0;
    },

    async finalizeFile(
      id: string,
      counts: { accepted: number; duplicates: number; rejected: number; rejectReasons: RejectedRow[]; status: "done" | "failed" }
    ) {
      const { error } = await supabase
        .from("ingested_files")
        .update({
          status: counts.status,
          rows_accepted: counts.accepted,
          rows_duplicate: counts.duplicates,
          rows_rejected: counts.rejected,
          reject_reasons: counts.rejectReasons as unknown as Database["public"]["Tables"]["ingested_files"]["Update"]["reject_reasons"],
        })
        .eq("id", id);

      if (error) throw error;
    },
  };
}
