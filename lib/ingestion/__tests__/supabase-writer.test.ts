import { describe, it, expect, vi } from "vitest";
import {
  createSupabaseWriter,
  createPendingFileAccess,
  chunkRows,
  UPSERT_CHUNK_SIZE,
} from "../supabase-writer";
import { PROCESSING_LEASE_SECONDS } from "../pending-state";
import type { NormalisedVerificationRow } from "../types";

/**
 * A minimal fake mimicking the chainable supabase-js query-builder surface
 * that supabase-writer.ts actually calls. Each `from(table)` call returns a
 * fresh chainable object so `.eq()`/`.select()`/`.single()` etc can be
 * asserted independently per table.
 */
function makeFakeSupabase(overrides: {
  findFileByHashResult?: { id: string; uploaded_at: string; report_type: string | null } | null;
  recordFileId?: string;
  insertedVerificationIds?: { id: number }[];
  insertedGenericIds?: { id: number }[];
  // Task 1 (13-03): the pending-file-access surface's test knobs.
  rpcImpl?: (fn: string, args: Record<string, unknown> | undefined) => Promise<{ data: unknown; error: unknown }>;
  loadPendingFileResult?: Record<string, unknown> | null;
  downloadResult?: { data: { arrayBuffer: () => Promise<ArrayBuffer> } | null; error: unknown };
} = {}) {
  const {
    findFileByHashResult = null,
    recordFileId = "file-1",
    insertedVerificationIds = [],
    insertedGenericIds = [],
    rpcImpl = () => Promise.resolve({ data: [], error: null }),
    loadPendingFileResult = null,
    downloadResult = { data: { arrayBuffer: async () => new ArrayBuffer(0) }, error: null },
  } = overrides;

  const uploadMock = vi.fn().mockResolvedValue({ data: { path: "some/path" }, error: null });
  const downloadMock = vi.fn().mockResolvedValue(downloadResult);
  const updateEqMock = vi.fn();
  const genericUpsertMock = vi.fn();
  const verificationUpsertMock = vi.fn();
  const rpcMock = vi.fn(rpcImpl);
  // Task 3 (09-01): capture the object handed to `.insert(...)` on
  // ingested_files, one payload per call, so provenance assertions can
  // inspect the exact fields the writer built — without disturbing the
  // existing chained `select().single()` shape any current test relies on.
  const ingestedFilesInsertPayloads: Record<string, unknown>[] = [];
  const ingestedFilesUpsertOptions: unknown[] = [];
  const findFileByHashFilters: [string, unknown][] = [];
  // Task 1 (13-03): one entry per completed `.update(...).eq(...)...` chain,
  // in call order, so a test can assert whether a finalize was filtered on
  // the id alone (push/drain, unresumed) or on id + pending status (resumed).
  const updateCallsLog: [string, unknown][][] = [];
  const pendingSelectFilters: [string, unknown][] = [];

  const from = vi.fn((table: string) => {
    if (table === "ingested_files") {
      // quick-261005-kz3: findFileByHash now chains TWO .eq() calls —
      // content_sha256 AND status='done' — so the stub must stay chainable
      // rather than terminating at the first one. The status filter is
      // captured so a test can assert it is actually applied.
      const chainable = {
        eq: (column: string, value: unknown) => {
          findFileByHashFilters.push([column, value]);
          return {
            ...chainable,
            maybeSingle: () =>
              Promise.resolve({ data: findFileByHashResult, error: null }),
          };
        },
      };
      return {
        // Task 1 (13-03): `loadPendingFile` selects a different column list
        // (it includes `processing_attempts`, a column findFileByHash never
        // reads) — branch on that to give it its own chain and its own
        // configurable result, without disturbing findFileByHash's shape.
        select: (columns?: string) => {
          if (columns && columns.includes("processing_attempts")) {
            const pendingChain = {
              eq: (column: string, value: unknown) => {
                pendingSelectFilters.push([column, value]);
                return pendingChain;
              },
              maybeSingle: () =>
                Promise.resolve({ data: loadPendingFileResult, error: null }),
            };
            return pendingChain;
          }
          return chainable;
        },
        // recordFile upserts on content_sha256 now, so a retry reuses the row
        // left behind by an attempt that died mid-write.
        upsert: (payload: Record<string, unknown>, options?: unknown) => {
          ingestedFilesInsertPayloads.push(payload);
          ingestedFilesUpsertOptions.push(options);
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: recordFileId }, error: null }),
            }),
          };
        },
        // Task 1 (13-03): chainable AND awaitable, so finalizeFile's
        // `.update(update).eq("id", id)` (unresumed) and
        // `.update(update).eq("id", id).eq("status", "pending")` (resumed)
        // both work against the same stub. `updateEqMock` keeps recording
        // every individual `.eq()` call (preserves the pre-existing
        // `toHaveBeenCalledWith("id", "file-1")` assertion unchanged);
        // `updateCallsLog` additionally captures the full filter set per
        // completed call, which is what the new resumed/unresumed tests read.
        update: () => {
          const filters: [string, unknown][] = [];
          const chain = {
            eq: (column: string, value: unknown) => {
              filters.push([column, value]);
              updateEqMock(column, value);
              return chain;
            },
            then: (
              resolve: (value: { error: null }) => unknown,
              reject?: (reason: unknown) => unknown
            ) => {
              updateCallsLog.push([...filters]);
              return Promise.resolve({ error: null }).then(resolve, reject);
            },
          };
          return chain;
        },
      };
    }
    if (table === "verifications") {
      return {
        // quick-261005-fd9: the writer now awaits `.upsert(...)` directly and
        // reads `count`, instead of chaining `.select("id")` and taking
        // `data.length` — returning one id per inserted row was tens of
        // thousands of ids for a single number at report scale.
        upsert: (...args: unknown[]) => {
          verificationUpsertMock(...args);
          return Promise.resolve({
            count: insertedVerificationIds.length,
            error: null,
          });
        },
      };
    }
    // Any other table name is a Wave 2 report table hitting the generic
    // upsertRows path — capture the upsert call so tests can assert
    // (onConflict, ignoreDuplicates, and the mapped rows) were forwarded.
    return {
      upsert: (...args: unknown[]) => {
        genericUpsertMock(table, ...args);
        return Promise.resolve({ count: insertedGenericIds.length, error: null });
      },
    };
  });

  const storage = {
    from: vi.fn(() => ({
      upload: uploadMock,
      download: downloadMock,
    })),
  };

  return {
    from,
    storage,
    rpc: rpcMock,
    updateEqMock,
    uploadMock,
    downloadMock,
    genericUpsertMock,
    verificationUpsertMock,
    ingestedFilesInsertPayloads,
    ingestedFilesUpsertOptions,
    findFileByHashFilters,
    updateCallsLog,
    pendingSelectFilters,
  } as const;
}

const sampleRow: NormalisedVerificationRow = {
  created_at: "2026-08-13T01:23:37.823Z",
  raw_created_at: "2026-08-13T01:23:37.823",
  external_card_reference: "525346UCgjCE5804",
  cvi2_value: 548,
  duration_ms: 96.0686,
  authenticated: false,
};

describe("createSupabaseWriter", () => {
  it("findFileByHash returns null when no prior ingested_files row exists", async () => {
    const fake = makeFakeSupabase({ findFileByHashResult: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = createSupabaseWriter(fake as any);
    const result = await writer.findFileByHash("deadbeef");
    expect(result).toBeNull();
  });

  it("findFileByHash returns the prior row when content_sha256 already exists", async () => {
    const fake = makeFakeSupabase({
      findFileByHashResult: {
        id: "existing-id",
        uploaded_at: "2026-08-13T00:00:00Z",
        report_type: "verification",
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = createSupabaseWriter(fake as any);
    const result = await writer.findFileByHash("deadbeef");
    expect(result).toEqual({
      id: "existing-id",
      uploaded_at: "2026-08-13T00:00:00Z",
      report_type: "verification",
    });
  });

  it("recordFile uploads the raw bytes to the reports bucket and inserts an ingested_files row", async () => {
    const fake = makeFakeSupabase({ recordFileId: "file-42" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = createSupabaseWriter(fake as any);
    const id = await writer.recordFile({
      fileName: "daily-ver-report_2026-08-13.csv",
      contentSha256: "deadbeef",
      uploadedBy: "user-1",
      reportType: "verification",
      bytes: new TextEncoder().encode("a,b,c"),
    });
    expect(id).toBe("file-42");
    expect(fake.storage.from).toHaveBeenCalledWith("reports");
    expect(fake.uploadMock).toHaveBeenCalledTimes(1);
  });

  it("upsertVerifications computes accepted count from rows actually inserted (ignoreDuplicates)", async () => {
    // 3 rows submitted, only 2 actually inserted (1 collided on row_hash)
    const fake = makeFakeSupabase({ insertedVerificationIds: [{ id: 1 }, { id: 2 }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = createSupabaseWriter(fake as any);
    // recordFile must run first in real usage to set the closure's current file id
    await writer.recordFile({
      fileName: "f.csv",
      contentSha256: "hash",
      uploadedBy: "user-1",
      reportType: "verification",
      bytes: new Uint8Array(),
    });
    const inserted = await writer.upsertVerifications([sampleRow, sampleRow, sampleRow]);
    expect(inserted).toBe(2);
  });

  it("upsertVerifications returns 0 for an empty row set without calling the DB", async () => {
    const fake = makeFakeSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = createSupabaseWriter(fake as any);
    const inserted = await writer.upsertVerifications([]);
    expect(inserted).toBe(0);
  });

  it("finalizeFile updates the ingested_files row with status done and counts", async () => {
    const fake = makeFakeSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = createSupabaseWriter(fake as any);
    await writer.finalizeFile("file-1", {
      accepted: 2,
      duplicates: 1,
      rejected: 0,
      excluded: 23,
      rejectReasons: [],
      status: "done",
    });
    expect(fake.updateEqMock).toHaveBeenCalledWith("id", "file-1");
  });

  it("upsertRows delegates to the named table with the given onConflict/ignoreDuplicates and returns the inserted count", async () => {
    const fake = makeFakeSupabase({ insertedGenericIds: [{ id: 1 }, { id: 2 }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = createSupabaseWriter(fake as any);
    await writer.recordFile({
      fileName: "daily-dcvv-report_2026-08-13.csv",
      contentSha256: "hash",
      uploadedBy: "user-1",
      reportType: "dcvv",
      bytes: new TextEncoder().encode("a,b,c"),
    });
    const inserted = await writer.upsertRows(
      "dcvv_fetches",
      [{ timestamp: "2026-08-13T00:00:00Z" }, { timestamp: "2026-08-13T01:00:00Z" }, { timestamp: "2026-08-13T02:00:00Z" }],
      { onConflict: "row_hash", ignoreDuplicates: true }
    );
    expect(inserted).toBe(2);
    expect(fake.genericUpsertMock).toHaveBeenCalledWith(
      "dcvv_fetches",
      expect.any(Array),
      { onConflict: "row_hash", ignoreDuplicates: true, count: "exact" }
    );
  });

  it("upsertRows returns 0 for an empty row set without calling the DB", async () => {
    const fake = makeFakeSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = createSupabaseWriter(fake as any);
    const inserted = await writer.upsertRows("dcvv_fetches", [], { onConflict: "row_hash", ignoreDuplicates: true });
    expect(inserted).toBe(0);
    expect(fake.genericUpsertMock).not.toHaveBeenCalled();
  });

  it("upsertRows throws if called before recordFile — no source_file_id available", async () => {
    const fake = makeFakeSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = createSupabaseWriter(fake as any);
    await expect(
      writer.upsertRows("dcvv_fetches", [{ a: 1 }], { onConflict: "row_hash", ignoreDuplicates: true })
    ).rejects.toThrow(/before recordFile/);
  });

  it("recordFile uploads a CSV with contentType text/csv, detected from the bytes (not the filename)", async () => {
    const fake = makeFakeSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = createSupabaseWriter(fake as any);
    await writer.recordFile({
      fileName: "whatever.xlsx", // deliberately mismatched extension — bytes must decide
      contentSha256: "hash",
      uploadedBy: "user-1",
      reportType: "verification",
      bytes: new TextEncoder().encode("CreatedAt,ExternalCardReference"),
    });
    expect(fake.uploadMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ contentType: "text/csv" })
    );
  });

  it("recordFile uploads an XLSX (ZIP magic bytes) with the spreadsheetml contentType", async () => {
    const fake = makeFakeSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = createSupabaseWriter(fake as any);
    const zipMagicBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    await writer.recordFile({
      fileName: "Copy of Safecypher Stats 1208 to 1308.xlsx",
      contentSha256: "hash2",
      uploadedBy: "user-1",
      reportType: "apigee-stats",
      bytes: zipMagicBytes,
    });
    expect(fake.uploadMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      expect.objectContaining({
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
    );
  });

  // --- Task 3 (09-01): AUTO-06/AUTO-07 — the manual path's provenance
  // default is asserted explicitly, not inferred, and the writer's new
  // provenance parameter is proved to isolate correctly per instance. ---

  it("createSupabaseWriter(fake) with no options inserts provenance source 'manual' with a null reference and a null credential id — the default path, byte-identical for app/api/ingest/route.ts", async () => {
    const fake = makeFakeSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = createSupabaseWriter(fake as any);
    await writer.recordFile({
      fileName: "daily-ver-report_2026-08-13.csv",
      contentSha256: "hash-manual",
      uploadedBy: "user-1",
      reportType: "verification",
      bytes: new TextEncoder().encode("a,b,c"),
    });

    expect(fake.ingestedFilesInsertPayloads).toHaveLength(1);
    expect(fake.ingestedFilesInsertPayloads[0]).toMatchObject({
      source: "manual",
      source_ref: null,
      source_credential_id: null,
    });
  });

  it("createSupabaseWriter(fake, { source: 'push', sourceRef, sourceCredentialId }) inserts 'push', that exact key unmodified, and that credential id", async () => {
    const fake = makeFakeSupabase();
    const someKey = "11111111-1111-1111-1111-111111111111/20260925T060000Z-0-abcd-daily-ver-report.csv";
    const writer = createSupabaseWriter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fake as any,
      {
        source: "push",
        sourceRef: someKey,
        sourceCredentialId: "11111111-1111-1111-1111-111111111111",
      }
    );
    await writer.recordFile({
      fileName: "daily-ver-report_2026-08-13.csv",
      contentSha256: "hash-push",
      uploadedBy: null,
      reportType: "verification",
      bytes: new TextEncoder().encode("a,b,c"),
    });

    expect(fake.ingestedFilesInsertPayloads).toHaveLength(1);
    // Exact string equality — no trimming, no encoding, no re-normalisation.
    expect(fake.ingestedFilesInsertPayloads[0]).toMatchObject({
      source: "push",
      source_ref: someKey,
      source_credential_id: "11111111-1111-1111-1111-111111111111",
    });
  });

  it("two writers constructed from the same client with different provenance references each insert their own reference — per-file isolation the drain loop depends on", async () => {
    const fake = makeFakeSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writerA = createSupabaseWriter(fake as any, { source: "push", sourceRef: "key-a" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writerB = createSupabaseWriter(fake as any, { source: "push", sourceRef: "key-b" });

    await writerA.recordFile({
      fileName: "a.csv",
      contentSha256: "hash-a",
      uploadedBy: null,
      reportType: "verification",
      bytes: new TextEncoder().encode("a"),
    });
    await writerB.recordFile({
      fileName: "b.csv",
      contentSha256: "hash-b",
      uploadedBy: null,
      reportType: "verification",
      bytes: new TextEncoder().encode("b"),
    });

    expect(fake.ingestedFilesInsertPayloads).toHaveLength(2);
    expect(fake.ingestedFilesInsertPayloads[0]).toMatchObject({ source_ref: "key-a" });
    expect(fake.ingestedFilesInsertPayloads[1]).toMatchObject({ source_ref: "key-b" });
  });
});

/**
 * quick-261005-kz3 — a failed upload must not permanently block its own retry.
 *
 * `findFileByHash` matched on content_sha256 alone. A run that died after
 * `recordFile` but before `finalizeFile` leaves the row at `pending`, and the
 * unfiltered lookup then reported that half-written attempt as a prior
 * successful upload. Five rows were stranded in production on 2026-10-05 —
 * the oldest since 2 October — each permanently blocking the file that created
 * it, with the UI saying "This file appears to have already been uploaded".
 */
describe("findFileByHash — only a completed ingest counts as already-uploaded", () => {
  it("filters on status='done', not on the hash alone", async () => {
    const fake = makeFakeSupabase({ findFileByHashResult: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = createSupabaseWriter(fake as any);
    await writer.findFileByHash("deadbeef");

    expect(fake.findFileByHashFilters).toEqual([
      ["content_sha256", "deadbeef"],
      ["status", "done"],
    ]);
  });

  it("still short-circuits on a genuinely completed upload", async () => {
    const fake = makeFakeSupabase({
      findFileByHashResult: {
        id: "done-row",
        uploaded_at: "2026-10-05T09:53:45Z",
        report_type: "apigee-stats",
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = createSupabaseWriter(fake as any);
    const result = await writer.findFileByHash("deadbeef");

    expect(result).not.toBeNull();
    expect(result?.id).toBe("done-row");
  });

  it("returns null when the only prior row is NOT done, so the retry proceeds", async () => {
    // The query itself excludes non-done rows, so the DB returns nothing —
    // which is exactly the behaviour the stranded `pending` rows needed.
    const fake = makeFakeSupabase({ findFileByHashResult: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = createSupabaseWriter(fake as any);

    expect(await writer.findFileByHash("hash-of-a-pending-row")).toBeNull();
    expect(fake.findFileByHashFilters).toContainEqual(["status", "done"]);
  });
});

describe("recordFile — reuses a stranded row rather than duplicating it", () => {
  it("upserts on content_sha256 so the UNIQUE constraint cannot block a retry", async () => {
    const fake = makeFakeSupabase({ recordFileId: "reused-row" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = createSupabaseWriter(fake as any);

    const id = await writer.recordFile({
      fileName: "Safecypher Stats 0310 to 0410.xlsx",
      contentSha256: "b53eee2b44cf",
      uploadedBy: "user-1",
      reportType: "apigee-stats",
      bytes: new TextEncoder().encode("x"),
    });

    expect(id).toBe("reused-row");
    expect(fake.ingestedFilesUpsertOptions).toEqual([
      { onConflict: "content_sha256" },
    ]);
  });

  it("resets the reused row to pending for the fresh attempt", async () => {
    const fake = makeFakeSupabase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = createSupabaseWriter(fake as any);

    await writer.recordFile({
      fileName: "Safecypher Stats 0310 to 0410.xlsx",
      contentSha256: "b53eee2b44cf",
      uploadedBy: "user-1",
      reportType: "apigee-stats",
      bytes: new TextEncoder().encode("x"),
    });

    expect(fake.ingestedFilesInsertPayloads[0]).toMatchObject({
      content_sha256: "b53eee2b44cf",
      status: "pending",
    });
  });
});

/**
 * Task 1 (13-03): a writer that can pick up a file it did not record. The
 * seam this task cuts — `createSupabaseWriter(client, { resumeFileId })` —
 * is what lets the processing path write report rows against a file id the
 * current process never called `recordFile` for.
 */
describe("createSupabaseWriter({ resumeFileId }) — a writer that can resume a file it did not record", () => {
  it("upsertVerifications succeeds with no prior recordFile call, stamping rows with the resumed id", async () => {
    const fake = makeFakeSupabase({ insertedVerificationIds: [{ id: 1 }] });
    const writer = createSupabaseWriter(fake as any, { resumeFileId: "resumed-file-1" });

    const inserted = await writer.upsertVerifications([sampleRow]);

    expect(inserted).toBe(1);
    expect(fake.verificationUpsertMock).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ source_file_id: "resumed-file-1" })]),
      expect.anything()
    );
  });

  it("upsertRows succeeds with no prior recordFile call, stamping rows with the resumed id", async () => {
    const fake = makeFakeSupabase({ insertedGenericIds: [{ id: 1 }] });
    const writer = createSupabaseWriter(fake as any, { resumeFileId: "resumed-file-2" });

    const inserted = await writer.upsertRows(
      "dcvv_fetches",
      [{ timestamp: "2026-08-13T00:00:00Z" }],
      { onConflict: "row_hash", ignoreDuplicates: true }
    );

    expect(inserted).toBe(1);
    expect(fake.genericUpsertMock).toHaveBeenCalledWith(
      "dcvv_fetches",
      expect.arrayContaining([expect.objectContaining({ source_file_id: "resumed-file-2" })]),
      expect.anything()
    );
  });

  it("finalizeFile succeeds with no prior recordFile call, filtered on BOTH the id and a pending status", async () => {
    const fake = makeFakeSupabase();
    const writer = createSupabaseWriter(fake as any, { resumeFileId: "resumed-file-3" });

    await writer.finalizeFile("resumed-file-3", {
      accepted: 1,
      duplicates: 0,
      rejected: 0,
      excluded: 0,
      rejectReasons: [],
      status: "done",
    });

    expect(fake.updateCallsLog).toContainEqual([
      ["id", "resumed-file-3"],
      ["status", "pending"],
    ]);
  });

  it("never calls recordFile and never uploads to Storage across a resumed writer's whole lifetime", async () => {
    const fake = makeFakeSupabase({ insertedVerificationIds: [{ id: 1 }], insertedGenericIds: [{ id: 1 }] });
    const writer = createSupabaseWriter(fake as any, { resumeFileId: "resumed-file-4" });

    await writer.upsertVerifications([sampleRow]);
    await writer.upsertRows("dcvv_fetches", [{ a: 1 }], { onConflict: "row_hash", ignoreDuplicates: true });
    await writer.finalizeFile("resumed-file-4", {
      accepted: 1,
      duplicates: 0,
      rejected: 0,
      excluded: 0,
      rejectReasons: [],
      status: "done",
    });

    expect(fake.uploadMock).not.toHaveBeenCalled();
  });

  it("chunking is unchanged for a resumed writer: 2,500 rows produce three batches of 1000, 1000 and 500", async () => {
    const fake = makeFakeSupabase({ insertedGenericIds: [{ id: 1 }] });
    const writer = createSupabaseWriter(fake as any, { resumeFileId: "resumed-file-5" });
    const rows = Array.from({ length: 2500 }, (_, i) => ({ n: i }));

    await writer.upsertRows("dcvv_fetches", rows, { onConflict: "row_hash", ignoreDuplicates: true });

    expect(fake.genericUpsertMock).toHaveBeenCalledTimes(3);
    const batchSizes = fake.genericUpsertMock.mock.calls.map(
      (call) => (call[1] as unknown[]).length
    );
    expect(batchSizes).toEqual([1000, 1000, 500]);
  });
});

describe("createSupabaseWriter() without resumeFileId — unchanged for the push/drain and manual paths", () => {
  it("upsertRows still throws the existing message when recordFile has not run", async () => {
    const fake = makeFakeSupabase();
    const writer = createSupabaseWriter(fake as any);

    await expect(
      writer.upsertRows("dcvv_fetches", [{ a: 1 }], { onConflict: "row_hash", ignoreDuplicates: true })
    ).rejects.toThrow(/before recordFile/);
  });

  it("finalizeFile issues an update filtered on the id ALONE — byte-identical to today", async () => {
    const fake = makeFakeSupabase();
    const writer = createSupabaseWriter(fake as any);

    await writer.finalizeFile("file-1", {
      accepted: 1,
      duplicates: 0,
      rejected: 0,
      excluded: 0,
      rejectReasons: [],
      status: "done",
    });

    expect(fake.updateCallsLog).toContainEqual([["id", "file-1"]]);
  });
});

/**
 * Task 1 (13-03): `createPendingFileAccess` — the four capabilities the
 * processing path needs that `ingest()` must never have. A sibling factory
 * in the same module, deliberately not part of `IngestDeps`.
 */
describe("createPendingFileAccess", () => {
  it("claimForProcessing invokes the claim function with the id and the imported lease constant, reporting a claimed result with the attempt count", async () => {
    const rpcImpl = vi.fn().mockResolvedValue({
      data: [{ claimed_id: "file-9", attempts: 2 }],
      error: null,
    });
    const fake = makeFakeSupabase({ rpcImpl });
    const access = createPendingFileAccess(fake as any);

    const result = await access.claimForProcessing("file-9");

    expect(rpcImpl).toHaveBeenCalledWith("fn_try_claim_ingested_file", {
      p_id: "file-9",
      p_lease_seconds: PROCESSING_LEASE_SECONDS,
    });
    expect(result).toEqual({ claimed: true, attempts: 2 });
  });

  it("reports not-claimed and no error when the claim function returns an empty array", async () => {
    const rpcImpl = vi.fn().mockResolvedValue({ data: [], error: null });
    const fake = makeFakeSupabase({ rpcImpl });
    const access = createPendingFileAccess(fake as any);

    const result = await access.claimForProcessing("file-10");

    expect(result).toEqual({ claimed: false });
  });

  it("throws when the claim function returns an error — a broken database is never mistaken for a lost claim", async () => {
    const rpcImpl = vi.fn().mockResolvedValue({ data: null, error: new Error("db unreachable") });
    const fake = makeFakeSupabase({ rpcImpl });
    const access = createPendingFileAccess(fake as any);

    await expect(access.claimForProcessing("file-11")).rejects.toThrow("db unreachable");
  });

  it("loadPendingFile selects file name, report type, storage path, status, uploaded at and attempt count", async () => {
    const fake = makeFakeSupabase({
      loadPendingFileResult: {
        file_name: "daily-ver-report_2026-08-13.csv",
        report_type: "verification",
        storage_path: "deadbeef/daily-ver-report_2026-08-13.csv",
        status: "pending",
        uploaded_at: "2026-08-13T00:00:00Z",
        processing_attempts: 1,
      },
    });
    const access = createPendingFileAccess(fake as any);

    const row = await access.loadPendingFile("file-12");

    expect(row).toEqual({
      fileName: "daily-ver-report_2026-08-13.csv",
      reportType: "verification",
      storagePath: "deadbeef/daily-ver-report_2026-08-13.csv",
      status: "pending",
      uploadedAt: "2026-08-13T00:00:00Z",
      processingAttempts: 1,
    });
    expect(fake.pendingSelectFilters).toEqual([["id", "file-12"]]);
  });

  it("loadPendingFile returns null for a row that does not exist", async () => {
    const fake = makeFakeSupabase({ loadPendingFileResult: null });
    const access = createPendingFileAccess(fake as any);

    expect(await access.loadPendingFile("missing")).toBeNull();
  });

  it("downloadStoredBytes reads from the reports bucket and returns bytes", async () => {
    const bytes = new TextEncoder().encode("a,b,c");
    const fake = makeFakeSupabase({
      downloadResult: { data: { arrayBuffer: async () => bytes.buffer as ArrayBuffer }, error: null },
    });
    const access = createPendingFileAccess(fake as any);

    const result = await access.downloadStoredBytes("deadbeef/file.csv");

    expect(fake.storage.from).toHaveBeenCalledWith("reports");
    expect(fake.downloadMock).toHaveBeenCalledWith("deadbeef/file.csv");
    expect(Array.from(result)).toEqual(Array.from(bytes));
  });

  it("downloadStoredBytes throws on a Storage error", async () => {
    const fake = makeFakeSupabase({
      downloadResult: { data: null, error: new Error("object not found") },
    });
    const access = createPendingFileAccess(fake as any);

    await expect(access.downloadStoredBytes("missing/file.csv")).rejects.toThrow("object not found");
  });

  it("releaseClaim invokes the release function with the id", async () => {
    const rpcImpl = vi.fn().mockResolvedValue({ data: null, error: null });
    const fake = makeFakeSupabase({ rpcImpl });
    const access = createPendingFileAccess(fake as any);

    await access.releaseClaim("file-13");

    expect(rpcImpl).toHaveBeenCalledWith("fn_release_ingested_file_claim", { p_id: "file-13" });
  });
});

describe("chunkRows / UPSERT_CHUNK_SIZE — unchanged by this plan (quick-261005-fd9)", () => {
  it("still chunks at 1000", () => {
    expect(UPSERT_CHUNK_SIZE).toBe(1000);
    expect(chunkRows(Array.from({ length: 2500 }, (_, i) => i)).map((c) => c.length)).toEqual([
      1000, 1000, 500,
    ]);
  });
});
