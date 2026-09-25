import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import type { IngestDeps, NormalisedVerificationRow, RejectedRow, ReportType } from "./types";

/** Private Storage bucket created in the 01-03 migrations (public = false). */
const REPORTS_BUCKET = "reports";

export function buildSecretClient(): SupabaseClient<Database> {
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

/**
 * CR-03: `fileName` is client-controlled (the multipart Content-Disposition
 * name — attacker-settable independent of the UI). Strip path separators and
 * anything outside a conservative allow-list before it ever touches a Storage
 * key, so it can't escape the `<sha256>/` prefix or inject `/`/`..` segments.
 */
export function sanitiseFileName(name: string): string {
  const base = name.replace(/[\\/]/g, "_").replace(/[^a-zA-Z0-9._-]/g, "_");
  return base.slice(-200) || "upload";
}

function storagePath(contentSha256: string, fileName: string): string {
  return `${contentSha256}/${sanitiseFileName(fileName)}`;
}

/** ZIP magic number — XLSX is a ZIP container; CSV/text never starts with this. */
export function isXlsx(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/**
 * Derive the Storage upload `contentType` from the uploaded bytes' own
 * magic number, not the client-supplied `contentType`/extension — mirrors
 * the same "detect format from bytes, never trust the client" principle
 * `extractHeaderSignature` uses for classification (T-02-01).
 */
export function detectContentType(bytes: Uint8Array): string {
  return isXlsx(bytes)
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "text/csv";
}

/**
 * Provenance carried by the writer's closure for AUTO-06 — NEVER passed
 * through `ingest()`'s `meta` argument (09-RESEARCH.md Pitfall 1). Optional
 * on every field so `createSupabaseWriter(client)` with no second argument —
 * the manual upload path's existing call shape — keeps defaulting to
 * 'manual' with null reference/credential, byte-identical to today.
 */
export interface WriterProvenanceOptions {
  source?: "manual" | "push" | "email";
  sourceRef?: string;
  sourceCredentialId?: string;
}

/**
 * Builds the Supabase-backed `IngestDeps` implementation used by the real
 * upload path (`app/api/ingest/route.ts`) and, with push provenance, by the
 * drain route (`app/api/ingest/drain/route.ts`). Optionally accepts an
 * injected client for tests — production callers should call this with no
 * client argument so it builds the secret-key client itself.
 *
 * Stateful per call: `recordFile` stashes the ingested_files row id in a
 * closure variable that `upsertVerifications`/`upsertRows` read to satisfy
 * the `source_file_id` FK. This is safe because `ingest()` always calls
 * `recordFile` before those methods for a single file, and a fresh writer is
 * constructed per file (no cross-request AND no cross-file sharing — the
 * drain loop must construct one per object, never reuse one across a
 * batch, per 09-RESEARCH.md Pitfall 4).
 */
export function createSupabaseWriter(
  client?: SupabaseClient<Database>,
  options?: WriterProvenanceOptions
): IngestDeps {
  const supabase = client ?? buildSecretClient();
  let currentFileId: string | null = null;
  const source = options?.source ?? "manual";
  const sourceRef = options?.sourceRef ?? null;
  const sourceCredentialId = options?.sourceCredentialId ?? null;

  return {
    async findFileByHash(sha256) {
      const { data, error } = await supabase
        .from("ingested_files")
        .select("id, uploaded_at, report_type")
        .eq("content_sha256", sha256)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        uploaded_at: data.uploaded_at,
        // report_type is a free-text column; narrow back to the domain type.
        report_type: (data.report_type as ReportType | null) ?? null,
      };
    },

    async recordFile(meta) {
      const path = storagePath(meta.contentSha256, meta.fileName);

      // WR-01: upsert:true so a retry after a partial failure (storage
      // succeeded, DB insert failed → no audit row, so no dup short-circuit)
      // is never blocked by an orphaned object at the same key. The DB row +
      // content_sha256 UNIQUE constraint remain the real dedup guarantee.
      const { error: uploadError } = await supabase.storage
        .from(REPORTS_BUCKET)
        .upload(path, meta.bytes, {
          contentType: detectContentType(meta.bytes),
          upsert: true,
        });
      if (uploadError) throw uploadError;

      // AUTO-06: the provenance fields ride in this factory's closure, never
      // in `ingest()`'s `meta` argument (09-RESEARCH.md Pitfall 1). Built as
      // a named local variable (not a fresh object literal) so nothing else
      // about this insert call needs to change once `types/db.ts` is
      // regenerated in 09-05. supabase-js's generated `.insert()` overload
      // uses a `RejectExcessProperties` conditional type that maps any
      // unknown key to `never` and enforces that even against a variable
      // (not just a fresh literal, where TypeScript's own excess-property
      // check would apply) — so `types/db.ts` not yet knowing about
      // `source`/`source_ref`/`source_credential_id` still requires one
      // explicit, documented cast here, mirroring the existing untyped-table
      // escape hatch `upsertRows` already carries below.
      const insertPayload = {
        file_name: meta.fileName,
        content_sha256: meta.contentSha256,
        uploaded_by: meta.uploadedBy,
        report_type: meta.reportType,
        storage_path: path,
        status: "pending",
        source,
        source_ref: sourceRef,
        source_credential_id: sourceCredentialId,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from("ingested_files") as any)
        .insert(insertPayload)
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

    /**
     * Generic upsert used by every Wave 2 report handler (verification
     * keeps `upsertVerifications` above, untouched). The DB `UNIQUE` /
     * `GENERATED ALWAYS ... STORED` hash column is the real de-dup
     * guarantee (RESEARCH.md "Don't Hand-Roll") — this just picks
     * INSERT-vs-upsert behaviour via `onConflict`/`ignoreDuplicates`.
     */
    async upsertRows(
      table: string,
      rows: Record<string, unknown>[],
      opts: { onConflict: string; ignoreDuplicates: boolean }
    ) {
      if (rows.length === 0) return 0;
      if (!currentFileId) {
        throw new Error("upsertRows called before recordFile — no source_file_id available");
      }

      // `table` is a runtime-supplied name from a Wave 2 handler; the six
      // new report tables don't exist in the generated `Database` types
      // until their migrations land, so this method is intentionally
      // typed as a generic escape hatch (mirrors the untyped-table
      // pattern any generic upsert helper needs) — the DB's UNIQUE /
      // GENERATED hash column remains the real, type-checked guarantee.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const untypedSupabase = supabase as any;
      const { data, error } = await untypedSupabase
        .from(table)
        .upsert(
          rows.map((row) => ({ ...row, source_file_id: currentFileId as string })),
          { onConflict: opts.onConflict, ignoreDuplicates: opts.ignoreDuplicates }
        )
        .select("id");

      if (error) throw error;
      return data?.length ?? 0;
    },

    async finalizeFile(
      id: string,
      counts: {
        accepted: number;
        duplicates: number;
        rejected: number;
        excluded: number;
        rejectReasons: RejectedRow[];
        status: "done" | "failed";
      }
    ) {
      // WR-04: verifications may already be committed by the time we finalize —
      // if this update blips, the audit row would be stuck at 'pending' despite
      // the data being safely inserted. Retry a couple of times before giving up.
      const update = {
        status: counts.status,
        rows_accepted: counts.accepted,
        rows_duplicate: counts.duplicates,
        rows_rejected: counts.rejected,
        rows_excluded: counts.excluded,
        reject_reasons:
          counts.rejectReasons as unknown as Database["public"]["Tables"]["ingested_files"]["Update"]["reject_reasons"],
      };

      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error } = await supabase.from("ingested_files").update(update).eq("id", id);
        if (!error) return;
        lastError = error;
      }
      throw lastError;
    },
  };
}
