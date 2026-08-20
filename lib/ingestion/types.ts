/**
 * Source-agnostic ingestion contracts (INGEST-03).
 *
 * Every report source (manual drag-and-drop today; an automated file-drop
 * or webhook adapter later) constructs an `IngestionInput` and calls the
 * single shared `ingest()` function in `lib/ingestion/index.ts`. No source
 * adapter parses, validates, or writes to the database itself.
 */

/** The only report type wired up in Phase 1. Phase 2 adds the other five. */
export type ReportType = "verification";

export interface IngestionInput {
  fileName: string;
  /** Raw uploaded bytes. Parsing must only ever happen server-side. */
  bytes: Uint8Array;
  contentType?: string;
  /** Auth user id of the uploader (recorded for the audit trail). */
  uploadedBy: string;
}

export interface RejectedRow {
  row: number;
  reasons: string[];
}

export interface IngestionResult {
  reportType: ReportType | null;
  accepted: number;
  duplicates: number;
  rejected: number;
  rejectReasons: RejectedRow[];
  ingestedFileId: string | null;
  /** Set when this exact file content (by sha256) has already been ingested. */
  alreadyUploaded?: { date: string };
}

/**
 * A normalised verification row, ready to be written to the `verifications`
 * table. `row_hash` is intentionally NOT part of this shape — it is a
 * Postgres `GENERATED ALWAYS ... STORED` column computed by the database,
 * never in application code (see 01-03 migrations).
 */
export interface NormalisedVerificationRow {
  created_at: string;
  raw_created_at: string;
  external_card_reference: string;
  cvi2_value: number;
  duration_ms: number;
  authenticated: boolean;
}

/**
 * Injected dependencies keep `ingest()` a pure, testable function — no
 * direct Supabase/DB import inside `lib/ingestion/`. Production wiring
 * (Plan 01-05) implements this against the real Supabase client; tests
 * implement it against an in-memory fake.
 */
export interface IngestDeps {
  findFileByHash(sha256: string): Promise<{ id: string; uploaded_at: string } | null>;
  recordFile(meta: {
    fileName: string;
    contentSha256: string;
    uploadedBy: string;
    reportType: ReportType | null;
    /**
     * Raw uploaded bytes, passed through so the writer can persist the file
     * to private storage (DATA-07) as part of recording the audit row.
     * Added in Plan 01-05 — not present in Plan 01-04's original contract.
     */
    bytes: Uint8Array;
  }): Promise<string>;
  /** INSERT ... ON CONFLICT (row_hash) DO NOTHING RETURNING id; returns inserted count. */
  upsertVerifications(rows: NormalisedVerificationRow[]): Promise<number>;
  finalizeFile(
    id: string,
    counts: { accepted: number; duplicates: number; rejected: number; rejectReasons: RejectedRow[] }
  ): Promise<void>;
}
