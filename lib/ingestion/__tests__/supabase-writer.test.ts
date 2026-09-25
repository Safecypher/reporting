import { describe, it, expect, vi } from "vitest";
import { createSupabaseWriter } from "../supabase-writer";
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
} = {}) {
  const {
    findFileByHashResult = null,
    recordFileId = "file-1",
    insertedVerificationIds = [],
    insertedGenericIds = [],
  } = overrides;

  const uploadMock = vi.fn().mockResolvedValue({ data: { path: "some/path" }, error: null });
  const updateEqMock = vi.fn().mockResolvedValue({ error: null });
  const genericUpsertMock = vi.fn();
  // Task 3 (09-01): capture the object handed to `.insert(...)` on
  // ingested_files, one payload per call, so provenance assertions can
  // inspect the exact fields the writer built — without disturbing the
  // existing chained `select().single()` shape any current test relies on.
  const ingestedFilesInsertPayloads: Record<string, unknown>[] = [];

  const from = vi.fn((table: string) => {
    if (table === "ingested_files") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: findFileByHashResult, error: null }),
          }),
        }),
        insert: (payload: Record<string, unknown>) => {
          ingestedFilesInsertPayloads.push(payload);
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: recordFileId }, error: null }),
            }),
          };
        },
        update: () => ({
          eq: updateEqMock,
        }),
      };
    }
    if (table === "verifications") {
      return {
        upsert: () => ({
          select: () => Promise.resolve({ data: insertedVerificationIds, error: null }),
        }),
      };
    }
    // Any other table name is a Wave 2 report table hitting the generic
    // upsertRows path — capture the upsert call so tests can assert
    // (onConflict, ignoreDuplicates, and the mapped rows) were forwarded.
    return {
      upsert: (...args: unknown[]) => {
        genericUpsertMock(table, ...args);
        return {
          select: () => Promise.resolve({ data: insertedGenericIds, error: null }),
        };
      },
    };
  });

  const storage = {
    from: vi.fn(() => ({
      upload: uploadMock,
    })),
  };

  return {
    from,
    storage,
    updateEqMock,
    uploadMock,
    genericUpsertMock,
    ingestedFilesInsertPayloads,
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
      { onConflict: "row_hash", ignoreDuplicates: true }
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
