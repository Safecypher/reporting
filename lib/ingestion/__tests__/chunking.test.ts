import { describe, expect, it, vi } from "vitest";

import {
  UPSERT_CHUNK_SIZE,
  chunkRows,
  createSupabaseWriter,
} from "../supabase-writer";

/**
 * Pins the chunking introduced by quick-261005-fd9.
 *
 * Both upserts previously sent every row in ONE PostgREST request and chained
 * `.select("id")` to count what landed. Measured 2026-10-05, three TSYS
 * "Safecypher Stats" files produced 43,383 / 45,367 / 53,876 rows each —
 * against an `apigee_calls` table holding 28,998 rows in total — and
 * `/api/ingest` answered 504.
 *
 * Two properties must hold, and neither is visible at the call site: every row
 * is sent exactly once across the batches, and a failure part-way through is
 * never reported as success.
 */

describe("chunkRows — boundaries", () => {
  it("returns no chunks for an empty list, so no request is made at all", () => {
    expect(chunkRows([])).toEqual([]);
  });

  it("returns ONE chunk at exactly the chunk size, not two", () => {
    const rows = Array.from({ length: UPSERT_CHUNK_SIZE }, (_, i) => i);
    const chunks = chunkRows(rows);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(UPSERT_CHUNK_SIZE);
  });

  it("splits at one over the chunk size, leaving a single-row tail", () => {
    const rows = Array.from({ length: UPSERT_CHUNK_SIZE + 1 }, (_, i) => i);
    const chunks = chunkRows(rows);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(UPSERT_CHUNK_SIZE);
    expect(chunks[1]).toEqual([UPSERT_CHUNK_SIZE]);
  });

  it("loses and duplicates nothing at the real report size that broke this", () => {
    const rows = Array.from({ length: 53_876 }, (_, i) => i);
    const chunks = chunkRows(rows);
    expect(chunks).toHaveLength(Math.ceil(53_876 / UPSERT_CHUNK_SIZE));
    expect(chunks.flat()).toEqual(rows);
    expect(new Set(chunks.flat()).size).toBe(53_876);
  });

  it("honours an explicit size and rejects a nonsensical one", () => {
    expect(chunkRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(() => chunkRows([1], 0)).toThrow(/size must be >= 1/);
    expect(() => chunkRows([1], -1)).toThrow(/size must be >= 1/);
  });
});

/**
 * Minimal fake: `recordFile` must succeed first (it sets the source_file_id
 * the upserts require), then each `upsert` call is captured. `failOnBatch` is
 * 1-indexed and drives the partial-failure path.
 */
function makeFake(opts: { failOnBatch?: number } = {}) {
  const batches: Record<string, unknown>[][] = [];
  const optsSeen: unknown[] = [];
  const upsert = vi.fn((
    rows: Record<string, unknown>[],
    options?: { onConflict: string; ignoreDuplicates: boolean; count: string },
  ) => {
    batches.push(rows);
    optsSeen.push(options);
    if (opts.failOnBatch !== undefined && batches.length === opts.failOnBatch) {
      return Promise.resolve({
        count: null,
        error: { message: "simulated batch failure" },
      });
    }
    return Promise.resolve({ count: rows.length, error: null });
  });

  const from = vi.fn((table: string) => {
    if (table === "ingested_files") {
      // findFileByHash chains two .eq() calls (hash AND status='done'), and
      // recordFile upserts on content_sha256 — see quick-261005-kz3.
      const chainable: Record<string, unknown> = {};
      chainable.eq = () => ({
        ...chainable,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      });
      return {
        select: () => chainable,
        upsert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: { id: "file-1" }, error: null }),
          }),
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    }
    return { upsert };
  });

  return {
    batches,
    optsSeen,
    upsert,
    client: {
      from,
      storage: {
        from: () => ({
          upload: () => Promise.resolve({ data: { path: "p" }, error: null }),
        }),
      },
    },
  };
}

async function writerWithFile(fake: ReturnType<typeof makeFake>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const writer = createSupabaseWriter(fake.client as any);
  await writer.recordFile({
    fileName: "Safecypher Stats 0410 to 0510.xlsx",
    contentSha256: "hash",
    uploadedBy: "user-1",
    reportType: "apigee-stats",
    bytes: new TextEncoder().encode("x"),
  });
  return writer;
}

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ row_hash: `h${i}`, value: i }));

describe("upsertRows — chunked writes", () => {
  it("splits 2,500 rows into 1000/1000/500 and returns the total written", async () => {
    const fake = makeFake();
    const writer = await writerWithFile(fake);

    const written = await writer.upsertRows("apigee_calls", rows(2_500), {
      onConflict: "row_hash",
      ignoreDuplicates: true,
    });

    expect(fake.batches.map((b) => b.length)).toEqual([1000, 1000, 500]);
    expect(written).toBe(2_500);
  });

  it("sends every row exactly once — nothing dropped at a batch seam", async () => {
    const fake = makeFake();
    const writer = await writerWithFile(fake);

    await writer.upsertRows("apigee_calls", rows(2_500), {
      onConflict: "row_hash",
      ignoreDuplicates: true,
    });

    const sent = fake.batches.flat().map((r) => r.row_hash);
    expect(sent).toHaveLength(2_500);
    expect(new Set(sent).size).toBe(2_500);
    expect(sent[0]).toBe("h0");
    expect(sent[2_499]).toBe("h2499");
  });

  it("forwards onConflict, ignoreDuplicates and count on EVERY batch, not just the first", async () => {
    const fake = makeFake();
    const writer = await writerWithFile(fake);

    await writer.upsertRows("apigee_calls", rows(2_500), {
      onConflict: "row_hash",
      ignoreDuplicates: true,
    });

    expect(fake.upsert).toHaveBeenCalledTimes(3);
    expect(fake.optsSeen).toHaveLength(3);
    for (const options of fake.optsSeen) {
      expect(options).toEqual({
        onConflict: "row_hash",
        ignoreDuplicates: true,
        count: "exact",
      });
    }
  });

  it("THROWS when a middle batch fails — a partial write is never reported as success", async () => {
    const fake = makeFake({ failOnBatch: 2 });
    const writer = await writerWithFile(fake);

    await expect(
      writer.upsertRows("apigee_calls", rows(2_500), {
        onConflict: "row_hash",
        ignoreDuplicates: true,
      }),
    ).rejects.toMatchObject({ message: "simulated batch failure" });

    // It stopped at the failing batch rather than carrying on to the third.
    expect(fake.upsert).toHaveBeenCalledTimes(2);
  });

  it("makes no request at all for an empty row set", async () => {
    const fake = makeFake();
    const writer = await writerWithFile(fake);

    const written = await writer.upsertRows("apigee_calls", [], {
      onConflict: "row_hash",
      ignoreDuplicates: true,
    });

    expect(written).toBe(0);
    expect(fake.upsert).not.toHaveBeenCalled();
  });
});

describe("upsertVerifications — chunked writes", () => {
  const verificationRows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      created_at: "2026-08-13T01:23:37.823Z",
      raw_created_at: "2026-08-13T01:23:37.823",
      external_card_reference: `ref-${i}`,
      cvi2_value: 548,
      duration_ms: 96.0686,
      authenticated: false,
    }));

  it("chunks the verification path too — it had the same unbatched shape", async () => {
    const fake = makeFake();
    const writer = await writerWithFile(fake);

    const written = await writer.upsertVerifications(verificationRows(2_500));

    expect(fake.batches.map((b) => b.length)).toEqual([1000, 1000, 500]);
    expect(written).toBe(2_500);
  });

  it("THROWS when a batch fails rather than returning a short count", async () => {
    const fake = makeFake({ failOnBatch: 1 });
    const writer = await writerWithFile(fake);

    await expect(
      writer.upsertVerifications(verificationRows(1_500)),
    ).rejects.toMatchObject({ message: "simulated batch failure" });
  });
});
