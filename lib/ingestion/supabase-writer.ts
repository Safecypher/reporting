import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import type { IngestDeps, NormalisedVerificationRow, RejectedRow, ReportType } from "./types";
import { PROCESSING_LEASE_SECONDS } from "./pending-state";
// Relative import, NEVER the "@/" alias (lib/ingestion must stay importable
// by the Netlify background function's bundler, which resolves neither
// Next.js module specifiers nor this project's tsconfig path alias — 13-05).
import { pushRpc, pushTable } from "../push/tables";

/** Private Storage bucket created in the 01-03 migrations (public = false). */
const REPORTS_BUCKET = "reports";

/**
 * Rows per PostgREST request when writing report rows (quick-261005-fd9).
 *
 * Both upserts below used to send EVERY row in a single request and then call
 * `.select("id")`, which returned one id per inserted row purely so the
 * return value could be `data.length`. Measured 2026-10-05, three TSYS
 * "Safecypher Stats" files produced 43,383 / 45,367 / 53,876 rows each —
 * against an `apigee_calls` table holding 28,998 rows in total, so one upload
 * was ~1.6x the whole table in one request, with ~45,000 ids streamed back.
 * `/api/ingest` answered 504 and the upload failed.
 *
 * 1000 keeps each request small enough to complete well inside the function
 * budget while keeping the round-trip count modest (~45 for a file that size).
 */
export const UPSERT_CHUNK_SIZE = 1000;

/**
 * Splits rows into fixed-size batches. Exported for its tests: the boundary
 * behaviour (exactly one chunk-size, one over, and empty) is what guarantees
 * no row is dropped or sent twice, and that is not something to leave
 * un-pinned on the path that writes financial data.
 */
export function chunkRows<T>(rows: T[], size: number = UPSERT_CHUNK_SIZE): T[][] {
  if (size < 1) {
    throw new Error(`chunkRows: size must be >= 1, received ${size}`);
  }
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

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
  /**
   * Pre-seeds the writer's closure file-id variable from an EXISTING
   * `ingested_files` row id, so the row-writing methods work in a process
   * that never called `recordFile` — exactly and only the background
   * function (13-05) resuming a file `claimForProcessing` already claimed.
   * A writer constructed with this option never calls `recordFile` and
   * never uploads to Storage; its `finalizeFile` is CONDITIONAL (see
   * below). Omitted, the writer behaves byte-identically to today.
   */
  resumeFileId?: string;
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
 *
 * `recordFile` still sets the closure id when it runs, exactly as above —
 * `options.resumeFileId` only matters when `recordFile` is never called in
 * this writer's lifetime, which is exactly and only the background function
 * in 13-05 resuming a file a prior request already recorded and claimed.
 */
export function createSupabaseWriter(
  client?: SupabaseClient<Database>,
  options?: WriterProvenanceOptions
): IngestDeps {
  const supabase = client ?? buildSecretClient();
  const resumeFileId = options?.resumeFileId ?? null;
  let currentFileId: string | null = resumeFileId;
  const source = options?.source ?? "manual";
  const sourceRef = options?.sourceRef ?? null;
  const sourceCredentialId = options?.sourceCredentialId ?? null;

  return {
    async findFileByHash(sha256) {
      // Only a COMPLETED ingest counts as "already uploaded" (quick-261005-kz3).
      //
      // This used to match on content_sha256 alone. A run that died after
      // recordFile but before finalizeFile leaves the row at `pending`, and
      // the unfiltered lookup then reported that half-written attempt as a
      // prior successful upload — so the file could never be retried. Five
      // such rows were stranded in production on 2026-10-05, the oldest since
      // 2 October, each one permanently blocking the file that created it.
      //
      // `pending` and `failed` deliberately fall through to a real ingest.
      // Re-running is safe: every report table de-dups on its own row_hash /
      // UNIQUE constraint, which is the actual guarantee here — this lookup is
      // only a short-circuit to avoid redundant work.
      const { data, error } = await supabase
        .from("ingested_files")
        .select("id, uploaded_at, report_type")
        .eq("content_sha256", sha256)
        .eq("status", "done")
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

      // Upsert, not insert (quick-261005-kz3). `ingested_files` has
      // UNIQUE (content_sha256), so retrying a file whose previous attempt
      // died mid-write would otherwise fail on the constraint — the row from
      // that attempt is still there. Upserting reuses it, resetting status to
      // `pending` for this fresh attempt, so a stranded row heals itself on
      // the next upload instead of needing a manual delete.
      //
      // This cannot resurrect a completed ingest: findFileByHash above has
      // already short-circuited anything at `done` before we reach here.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from("ingested_files") as any)
        .upsert(insertPayload, { onConflict: "content_sha256" })
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

      // Chunked, and counted via `count: "exact"` rather than `.select("id")`
      // (quick-261005-fd9). The old form returned one id per inserted row only
      // to take its `.length`; at report scale that is tens of thousands of
      // ids over the wire for a single number. `count` gives the same number —
      // rows actually written, with `ignoreDuplicates` meaning duplicates are
      // not counted — without the payload.
      const payload = rows.map((row) => ({
        created_at: row.created_at,
        raw_created_at: row.raw_created_at,
        external_card_reference: row.external_card_reference,
        cvi2_value: row.cvi2_value,
        duration_ms: row.duration_ms,
        authenticated: row.authenticated,
        source_file_id: currentFileId as string,
      }));

      let written = 0;
      for (const batch of chunkRows(payload)) {
        const { count, error } = await supabase
          .from("verifications")
          .upsert(batch, {
            onConflict: "row_hash",
            ignoreDuplicates: true,
            count: "exact",
          });

        // Throw on the failing batch rather than carrying on. Earlier batches
        // stay written, which is safe precisely because the DB `row_hash`
        // UNIQUE constraint makes a re-upload idempotent — the same reasoning
        // that already justifies `upsert: true` on the Storage write. What
        // must never happen is returning a count as though the whole file
        // landed when part of it did not.
        if (error) throw error;
        written += count ?? 0;
      }
      return written;
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

      // Chunked and counted without round-tripping ids — see the note on
      // UPSERT_CHUNK_SIZE. This is the path every Wave 2 report takes,
      // including apigee_calls, which is the one that actually broke.
      // The push/drain route shares this writer, so it is fixed here too.
      const payload = rows.map((row) => ({
        ...row,
        source_file_id: currentFileId as string,
      }));

      let written = 0;
      for (const batch of chunkRows(payload)) {
        const { count, error } = await untypedSupabase
          .from(table)
          .upsert(batch, {
            onConflict: opts.onConflict,
            ignoreDuplicates: opts.ignoreDuplicates,
            count: "exact",
          });

        if (error) throw error;
        written += count ?? 0;
      }
      return written;
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
        let query = supabase.from("ingested_files").update(update).eq("id", id);
        if (resumeFileId !== null) {
          // T-13-35: a resumed writer's finalize is CONDITIONAL on the row
          // still being pending. A processing attempt whose lease has
          // expired could in principle still be alive; an unconditional
          // finalize from such a stale attempt would overwrite the audit
          // counts a later successful attempt already wrote. Filtering on
          // pending makes the stale finalize a no-op instead. The
          // push/drain writer never passes a resume id, so its finalize
          // keeps today's unconditional form, unchanged.
          query = query.eq("status", "pending");
        }
        const { error } = await query;
        if (!error) return;
        lastError = error;
      }
      throw lastError;
    },
  };
}

/**
 * Discriminated result of a claim attempt (`fn_try_claim_ingested_file`,
 * migration 0048/0049). `claimed: false` is an ordinary outcome — losing a
 * claim to a concurrent caller or a row that is no longer `pending` — not an
 * exception. A claim function returning an error (a broken database) throws
 * instead, so that is never mistaken for a lost claim.
 */
export type ClaimForProcessingResult = { claimed: true; attempts: number } | { claimed: false };

/**
 * The fields `processClaimedFile`/`runPendingFile` (13-05) need to resume a
 * file: enough to re-dispatch to the right handler and fetch its bytes back,
 * plus the attempt count for the stuck-pending surfaces (13-04/13-06).
 */
export interface PendingFileRow {
  fileName: string;
  reportType: ReportType | null;
  storagePath: string | null;
  status: string;
  uploadedAt: string;
  processingAttempts: number;
}

/**
 * The capabilities the processing path needs that `ingest()` must never
 * have: claim, load, download and release. Deliberately NOT part of
 * `IngestDeps` — see `createPendingFileAccess`'s own doc comment below.
 */
export interface PendingFileAccess {
  claimForProcessing(id: string): Promise<ClaimForProcessingResult>;
  loadPendingFile(id: string): Promise<PendingFileRow | null>;
  downloadStoredBytes(path: string): Promise<Uint8Array>;
  releaseClaim(id: string): Promise<void>;
}

/**
 * A sibling factory to `createSupabaseWriter` in this same module, built
 * for the same reason: shared client construction and the same documented
 * untyped-accessor discipline, with none of `createSupabaseWriter`'s
 * provenance/writer concerns. Kept OFF `IngestDeps` deliberately —
 * `IngestDeps` is the contract `ingest()` is pure over and every handler's
 * `upsert` receives; widening it would force every existing fake in the
 * ingestion test suite to grow four methods it has no use for, and would
 * hand the parsing layer a claim primitive it has no business holding.
 *
 * Routes the two RPC functions migration 0048/0049 created through
 * `pushRpc` — the same documented untyped-RPC escape hatch the drain lock
 * already uses (`fn_try_acquire_drain_lock`/`fn_release_drain_lock`), for
 * the same reason: the generated database types will not know these
 * signatures until they are regenerated (retired once `types/db.ts` is
 * regenerated against the live schema). `loadPendingFile`'s select is
 * routed through `pushTable` for the same reason — `processing_attempts`
 * is not yet in the generated `Database` types either.
 */
export function createPendingFileAccess(client?: SupabaseClient<Database>): PendingFileAccess {
  const supabase = client ?? buildSecretClient();

  return {
    async claimForProcessing(id: string): Promise<ClaimForProcessingResult> {
      // The lease window is passed explicitly rather than relying on the
      // SQL default: the default exists so the function is usable from a
      // psql session, but the application should be unambiguous about
      // which window it is asking for — read from the imported constant,
      // never a literal, since 13-02 already moved this number once.
      const { data, error } = await pushRpc(supabase, "fn_try_claim_ingested_file", {
        p_id: id,
        p_lease_seconds: PROCESSING_LEASE_SECONDS,
      });
      if (error) throw error;
      const rows = (data ?? []) as { claimed_id: string; attempts: number }[];
      if (rows.length === 0) return { claimed: false };
      return { claimed: true, attempts: rows[0].attempts };
    },

    async loadPendingFile(id: string): Promise<PendingFileRow | null> {
      const { data, error } = await pushTable(supabase, "ingested_files")
        .select("file_name, report_type, storage_path, status, uploaded_at, processing_attempts")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        fileName: data.file_name as string,
        reportType: (data.report_type as ReportType | null) ?? null,
        storagePath: (data.storage_path as string | null) ?? null,
        status: data.status as string,
        uploadedAt: data.uploaded_at as string,
        processingAttempts: data.processing_attempts as number,
      };
    },

    async downloadStoredBytes(path: string): Promise<Uint8Array> {
      const { data, error } = await supabase.storage.from(REPORTS_BUCKET).download(path);
      if (error) throw error;
      return new Uint8Array(await data.arrayBuffer());
    },

    async releaseClaim(id: string): Promise<void> {
      // Calls the already-proven-live SQL function (13-02 Task 3) rather
      // than re-implementing its pending-status guard in TypeScript — the
      // guard against disturbing an already-finalized row is the function
      // body itself, not something this layer re-asserts.
      const { error } = await pushRpc(supabase, "fn_release_ingested_file_claim", { p_id: id });
      if (error) throw error;
    },
  };
}
