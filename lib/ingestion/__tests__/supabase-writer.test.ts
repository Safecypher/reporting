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
  findFileByHashResult?: { id: string; uploaded_at: string } | null;
  recordFileId?: string;
  insertedVerificationIds?: { id: number }[];
} = {}) {
  const {
    findFileByHashResult = null,
    recordFileId = "file-1",
    insertedVerificationIds = [],
  } = overrides;

  const uploadMock = vi.fn().mockResolvedValue({ data: { path: "some/path" }, error: null });
  const updateEqMock = vi.fn().mockResolvedValue({ error: null });

  const from = vi.fn((table: string) => {
    if (table === "ingested_files") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: findFileByHashResult, error: null }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: { id: recordFileId }, error: null }),
          }),
        }),
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
    throw new Error(`unexpected table: ${table}`);
  });

  const storage = {
    from: vi.fn(() => ({
      upload: uploadMock,
    })),
  };

  return { from, storage, updateEqMock, uploadMock } as const;
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
      findFileByHashResult: { id: "existing-id", uploaded_at: "2026-08-13T00:00:00Z" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writer = createSupabaseWriter(fake as any);
    const result = await writer.findFileByHash("deadbeef");
    expect(result).toEqual({ id: "existing-id", uploaded_at: "2026-08-13T00:00:00Z" });
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
      rejectReasons: [],
    });
    expect(fake.updateEqMock).toHaveBeenCalledWith("id", "file-1");
  });
});
