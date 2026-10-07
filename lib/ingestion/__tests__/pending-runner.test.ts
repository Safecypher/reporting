import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IngestDeps, IngestionResult, ReportType } from "../types";
import type { ClaimForProcessingResult, PendingFileAccess, PendingFileRow } from "../supabase-writer";
import type { TriggerBackgroundProcessingResult } from "../process-trigger";
import { MAX_PROCESSING_ATTEMPTS, SWEEPABLE_AFTER_MINUTES, STUCK_PENDING_AFTER_HOURS } from "../pending-state";

/**
 * `processClaimedFile` is mocked so these tests drive `runPendingFile`'s own
 * orchestration (load → reject-the-unprocessable → claim → download →
 * process → release-on-error) in isolation from real parsing — the
 * ingestion test suite already proves `processClaimedFile`'s own behaviour
 * against the real fixture.
 */
const processClaimedFileMock = vi.fn();
vi.mock("../index", () => ({
  processClaimedFile: (...args: unknown[]) => processClaimedFileMock(...args),
}));

// Imported AFTER the mock so pending-runner.ts picks up the mocked export.
import { runPendingFile, sweepPendingFiles, type SweepTrigger } from "../pending-runner";
import { createPendingFileAccess } from "../supabase-writer";

function makeRow(overrides: Partial<PendingFileRow> = {}): PendingFileRow {
  return {
    fileName: "daily-ver-report_2026-08-13.csv",
    reportType: "verification",
    storagePath: "deadbeef/daily-ver-report_2026-08-13.csv",
    status: "pending",
    uploadedAt: "2026-08-13T00:00:00Z",
    processingAttempts: 0,
    ...overrides,
  };
}

function makeFakeAccess(
  overrides: {
    row?: PendingFileRow | null;
    claimResult?: ClaimForProcessingResult;
    bytes?: Uint8Array;
    downloadError?: unknown;
  } = {}
) {
  const {
    row = makeRow(),
    claimResult = { claimed: true, attempts: 1 },
    bytes = new TextEncoder().encode("a,b,c"),
    downloadError = null,
  } = overrides;

  const loadPendingFile = vi.fn().mockResolvedValue(row);
  const claimForProcessing = vi.fn().mockResolvedValue(claimResult);
  const downloadStoredBytes = vi.fn().mockImplementation(async () => {
    if (downloadError) throw downloadError;
    return bytes;
  });
  const releaseClaim = vi.fn().mockResolvedValue(undefined);
  // Not exercised by runPendingFile — stubbed only so this fixture still
  // satisfies the full PendingFileAccess shape (listSweepableFiles/
  // countStuckPendingFiles are this plan's sweep-only additions, tested in
  // their own describe blocks below against the real createPendingFileAccess).
  const listSweepableFiles = vi.fn().mockResolvedValue([]);
  const countStuckPendingFiles = vi.fn().mockResolvedValue({ count: 0, since: null });

  const access: PendingFileAccess = {
    loadPendingFile,
    claimForProcessing,
    downloadStoredBytes,
    releaseClaim,
    listSweepableFiles,
    countStuckPendingFiles,
  };

  return { access, loadPendingFile, claimForProcessing, downloadStoredBytes, releaseClaim };
}

function makeWriterFactory() {
  return vi.fn((_resumeFileId: string) => ({} as IngestDeps));
}

function makeFakeResult(overrides: Partial<IngestionResult> = {}): IngestionResult {
  return {
    reportType: "verification" as ReportType,
    accepted: 1,
    duplicates: 0,
    rejected: 0,
    excluded: 0,
    rejectReasons: [],
    ingestedFileId: "file-1",
    ...overrides,
  };
}

beforeEach(() => {
  processClaimedFileMock.mockReset();
});

describe("runPendingFile", () => {
  it("claims a claimable pending row, downloads its bytes once, processes, and reports processed with the result", async () => {
    const { access, downloadStoredBytes, claimForProcessing } = makeFakeAccess();
    const makeWriter = makeWriterFactory();
    const fakeResult = makeFakeResult();
    processClaimedFileMock.mockResolvedValue(fakeResult);

    const outcome = await runPendingFile("file-1", access, makeWriter);

    expect(claimForProcessing).toHaveBeenCalledWith("file-1");
    expect(downloadStoredBytes).toHaveBeenCalledTimes(1);
    expect(downloadStoredBytes).toHaveBeenCalledWith("deadbeef/daily-ver-report_2026-08-13.csv");
    expect(makeWriter).toHaveBeenCalledWith("file-1");
    expect(outcome).toEqual({ outcome: "processed", result: fakeResult });
  });

  it("reports not-claimable when the claim is refused, and the download spy records zero calls — nothing happens before the claim", async () => {
    const { access, downloadStoredBytes } = makeFakeAccess({ claimResult: { claimed: false } });
    const makeWriter = makeWriterFactory();

    const outcome = await runPendingFile("file-2", access, makeWriter);

    expect(outcome).toEqual({ outcome: "not-claimable" });
    expect(downloadStoredBytes).not.toHaveBeenCalled();
    expect(processClaimedFileMock).not.toHaveBeenCalled();
  });

  it("reports missing for a row that does not exist", async () => {
    const { access, claimForProcessing } = makeFakeAccess({ row: null });
    const makeWriter = makeWriterFactory();

    const outcome = await runPendingFile("file-3", access, makeWriter);

    expect(outcome).toEqual({ outcome: "missing" });
    expect(claimForProcessing).not.toHaveBeenCalled();
  });

  it("reports not-processable without throwing, claiming or downloading for a null report type (the unrecognised case, which should never reach here)", async () => {
    const { access, downloadStoredBytes, claimForProcessing } = makeFakeAccess({
      row: makeRow({ reportType: null }),
    });
    const makeWriter = makeWriterFactory();

    const outcome = await runPendingFile("file-4", access, makeWriter);

    expect(outcome).toEqual({ outcome: "not-processable", reason: "report_type is null" });
    expect(claimForProcessing).not.toHaveBeenCalled();
    expect(downloadStoredBytes).not.toHaveBeenCalled();
  });

  it("reports not-processable for a null storage path — a file with no bytes to fetch cannot be processed and must say so rather than crash", async () => {
    const { access, downloadStoredBytes } = makeFakeAccess({ row: makeRow({ storagePath: null }) });
    const makeWriter = makeWriterFactory();

    const outcome = await runPendingFile("file-5", access, makeWriter);

    expect(outcome).toEqual({ outcome: "not-processable", reason: "storage_path is null" });
    expect(downloadStoredBytes).not.toHaveBeenCalled();
  });

  it("releases the claim and reports errored rather than escaping when processing throws", async () => {
    const { access, releaseClaim } = makeFakeAccess();
    const makeWriter = makeWriterFactory();
    const thrown = new Error("parse exploded");
    processClaimedFileMock.mockRejectedValue(thrown);

    const outcome = await runPendingFile("file-6", access, makeWriter);

    expect(outcome).toEqual({ outcome: "errored", error: thrown });
    expect(releaseClaim).toHaveBeenCalledWith("file-6");
    expect(releaseClaim).toHaveBeenCalledTimes(1);
  });

  it("never releases the claim on the success path — a release after a successful finalize would obscure which path ran", async () => {
    const { access, releaseClaim } = makeFakeAccess();
    const makeWriter = makeWriterFactory();
    processClaimedFileMock.mockResolvedValue(makeFakeResult({ ingestedFileId: "file-7" }));

    await runPendingFile("file-7", access, makeWriter);

    expect(releaseClaim).not.toHaveBeenCalled();
  });

  it("also releases the claim exactly once when the download step itself throws", async () => {
    const { access, releaseClaim } = makeFakeAccess({ downloadError: new Error("storage unreachable") });
    const makeWriter = makeWriterFactory();

    const outcome = await runPendingFile("file-8", access, makeWriter);

    expect(outcome).toEqual({ outcome: "errored", error: new Error("storage unreachable") });
    expect(releaseClaim).toHaveBeenCalledTimes(1);
    expect(processClaimedFileMock).not.toHaveBeenCalled();
  });
});

/**
 * A minimal in-memory fake of the one table `listSweepableFiles`/
 * `countStuckPendingFiles` query — just enough of supabase-js's chainable
 * query-builder surface (`select`/`eq`/`lt`/`lte`/`or`/`order`/`limit`) to
 * drive `createPendingFileAccess`'s real implementation against fixture
 * rows, the same fake-client idiom `lib/notify/__tests__/drain-alert.test.ts`
 * uses to drive the real drain route.
 */
interface FakeIngestedFileRow {
  id: string;
  status: string;
  uploaded_at: string;
  processing_attempts: number;
  processing_started_at: string | null;
}

function makeFakeIngestedFilesClient(rows: FakeIngestedFileRow[]) {
  return {
    from(_table: string) {
      let working = [...rows];
      let wantCount = false;
      const builder = {
        select(_cols: string, opts?: { count?: string }) {
          wantCount = opts?.count === "exact";
          return builder;
        },
        eq(col: keyof FakeIngestedFileRow, val: unknown) {
          working = working.filter((r) => r[col] === val);
          return builder;
        },
        lt(col: keyof FakeIngestedFileRow, val: unknown) {
          working = working.filter((r) => {
            const v = r[col];
            return v !== null && (v as number | string) < (val as number | string);
          });
          return builder;
        },
        lte(col: keyof FakeIngestedFileRow, val: unknown) {
          working = working.filter((r) => {
            const v = r[col];
            return v !== null && (v as number | string) <= (val as number | string);
          });
          return builder;
        },
        or(expr: string) {
          const clauses = expr.split(",").map((c) => c.split("."));
          working = working.filter((r) =>
            clauses.some(([col, op, val]) => {
              const colVal = r[col as keyof FakeIngestedFileRow];
              if (op === "is" && val === "null") return colVal === null;
              if (op === "lt") return colVal !== null && (colVal as string) < val;
              return false;
            })
          );
          return builder;
        },
        order(col: keyof FakeIngestedFileRow, opts?: { ascending?: boolean }) {
          const asc = opts?.ascending !== false;
          working = [...working].sort((a, b) => {
            const av = a[col] as string;
            const bv = b[col] as string;
            if (av === bv) return 0;
            return asc ? (av < bv ? -1 : 1) : av > bv ? -1 : 1;
          });
          return builder;
        },
        limit(n: number) {
          const matched = working.length;
          const limited = working.slice(0, n);
          return Promise.resolve({ data: limited, error: null, count: wantCount ? matched : null });
        },
      };
      return builder;
    },
  };
}

function makeRow2(overrides: Partial<FakeIngestedFileRow> = {}): FakeIngestedFileRow {
  return {
    id: "row-1",
    status: "pending",
    uploaded_at: "2026-10-07T00:00:00.000Z",
    processing_attempts: 0,
    processing_started_at: null,
    ...overrides,
  };
}

describe("createPendingFileAccess — listSweepableFiles", () => {
  const ASOF = new Date("2026-10-07T01:00:00.000Z"); // one hour after the fixture's upload time

  it("selects only pending rows, ordered oldest upload first, and applies the row limit it is given", async () => {
    const rows = [
      makeRow2({ id: "newest", uploaded_at: "2026-10-07T00:20:00.000Z" }),
      makeRow2({ id: "oldest", uploaded_at: "2026-10-07T00:00:00.000Z" }),
      makeRow2({ id: "done-row", status: "done", uploaded_at: "2026-09-01T00:00:00.000Z" }),
      makeRow2({ id: "middle", uploaded_at: "2026-10-07T00:10:00.000Z" }),
    ];
    // ASOF - SWEEPABLE_AFTER_MINUTES is before all three pending rows' upload
    // times here, so widen ASOF so they all qualify as sweepable by age.
    const asOf = new Date(
      new Date("2026-10-07T00:20:00.000Z").getTime() + SWEEPABLE_AFTER_MINUTES * 60_000 + 1
    );
    const access = createPendingFileAccess(makeFakeIngestedFilesClient(rows) as never);

    const ids = await access.listSweepableFiles(asOf, 2);

    expect(ids).toEqual(["oldest", "middle"]);
  });

  it("the age filter it applies corresponds to the sweepable age; a row two minutes old is not returned", async () => {
    const twoMinutesOld = new Date(ASOF.getTime() - 2 * 60_000).toISOString();
    const pastSweepableAge = new Date(ASOF.getTime() - SWEEPABLE_AFTER_MINUTES * 60_000 - 1000).toISOString();
    const rows = [
      makeRow2({ id: "too-fresh", uploaded_at: twoMinutesOld }),
      makeRow2({ id: "old-enough", uploaded_at: pastSweepableAge }),
    ];
    const access = createPendingFileAccess(makeFakeIngestedFilesClient(rows) as never);

    const ids = await access.listSweepableFiles(ASOF, 10);

    expect(ids).toEqual(["old-enough"]);
  });

  it("rows at or above the attempt cap are excluded by the query, matching isSweepable's own rule", async () => {
    const pastSweepableAge = new Date(ASOF.getTime() - SWEEPABLE_AFTER_MINUTES * 60_000 - 1000).toISOString();
    const rows = [
      makeRow2({ id: "capped", uploaded_at: pastSweepableAge, processing_attempts: MAX_PROCESSING_ATTEMPTS }),
      makeRow2({
        id: "under-cap",
        uploaded_at: pastSweepableAge,
        processing_attempts: MAX_PROCESSING_ATTEMPTS - 1,
      }),
    ];
    const access = createPendingFileAccess(makeFakeIngestedFilesClient(rows) as never);

    const ids = await access.listSweepableFiles(ASOF, 10);

    expect(ids).toEqual(["under-cap"]);
  });
});

describe("createPendingFileAccess — countStuckPendingFiles", () => {
  const ASOF = new Date("2026-10-07T12:00:00.000Z");

  it("returns a count and the oldest upload time among pending rows at or past the stuck age", async () => {
    const pastStuckAge = (hoursAgo: number) =>
      new Date(ASOF.getTime() - hoursAgo * 3_600_000).toISOString();
    const rows = [
      makeRow2({ id: "stuck-older", uploaded_at: pastStuckAge(STUCK_PENDING_AFTER_HOURS + 2) }),
      makeRow2({ id: "stuck-newer", uploaded_at: pastStuckAge(STUCK_PENDING_AFTER_HOURS + 1) }),
      makeRow2({ id: "too-fresh", uploaded_at: pastStuckAge(1) }),
    ];
    const access = createPendingFileAccess(makeFakeIngestedFilesClient(rows) as never);

    const result = await access.countStuckPendingFiles(ASOF);

    expect(result.count).toBe(2);
    expect(result.since).toBe(pastStuckAge(STUCK_PENDING_AFTER_HOURS + 2));
  });

  it("returns a zero count and a null timestamp when none qualify, rather than throwing or returning a fabricated time", async () => {
    const rows = [makeRow2({ id: "fresh", uploaded_at: ASOF.toISOString() })];
    const access = createPendingFileAccess(makeFakeIngestedFilesClient(rows) as never);

    const result = await access.countStuckPendingFiles(ASOF);

    expect(result).toEqual({ count: 0, since: null });
  });

  it("counts a row at or above the attempt cap — the cap stops the sweeping, not the reporting", async () => {
    const pastStuckAge = new Date(
      ASOF.getTime() - (STUCK_PENDING_AFTER_HOURS + 1) * 3_600_000
    ).toISOString();
    const rows = [
      makeRow2({ id: "capped-and-stuck", uploaded_at: pastStuckAge, processing_attempts: MAX_PROCESSING_ATTEMPTS }),
    ];
    const access = createPendingFileAccess(makeFakeIngestedFilesClient(rows) as never);

    const result = await access.countStuckPendingFiles(ASOF);

    expect(result.count).toBe(1);
  });

  it("does not count a row currently under a live lease, however old its upload time", async () => {
    const pastStuckAge = new Date(
      ASOF.getTime() - (STUCK_PENDING_AFTER_HOURS + 1) * 3_600_000
    ).toISOString();
    const liveLeaseStartedAt = new Date(ASOF.getTime() - 60_000).toISOString(); // claimed one minute ago
    const rows = [
      makeRow2({ id: "old-but-processing", uploaded_at: pastStuckAge, processing_started_at: liveLeaseStartedAt }),
    ];
    const access = createPendingFileAccess(makeFakeIngestedFilesClient(rows) as never);

    const result = await access.countStuckPendingFiles(ASOF);

    expect(result).toEqual({ count: 0, since: null });
  });
});

describe("sweepPendingFiles", () => {
  function makeFakeSweepAccess(ids: string[]) {
    const listSweepableFiles = vi.fn().mockResolvedValue(ids);
    return { listSweepableFiles };
  }

  function fixedClock(value = 0): () => number {
    return () => value;
  }

  it("with three sweepable rows and a file limit of three, fires the trigger three times, once per id, and reports what each returned", async () => {
    const access = makeFakeSweepAccess(["a", "b", "c"]);
    const trigger: SweepTrigger = vi.fn().mockResolvedValue({ outcome: "fired" } satisfies TriggerBackgroundProcessingResult);

    const result = await sweepPendingFiles(access, trigger, {
      asOf: new Date("2026-10-07T00:00:00.000Z"),
      fileLimit: 3,
      budgetMs: 10_000,
      clock: fixedClock(),
    });

    expect(trigger).toHaveBeenCalledTimes(3);
    expect(trigger).toHaveBeenNthCalledWith(1, "a");
    expect(trigger).toHaveBeenNthCalledWith(2, "b");
    expect(trigger).toHaveBeenNthCalledWith(3, "c");
    expect(result.files).toEqual([
      { id: "a", outcome: "fired" },
      { id: "b", outcome: "fired" },
      { id: "c", outcome: "fired" },
    ]);
    expect(result.firedCount).toBe(3);
    expect(result.deferredCount).toBe(0);
  });

  it("with five sweepable rows and a file limit of three, fires three times and reports two as deferred", async () => {
    const access = makeFakeSweepAccess(["a", "b", "c", "d", "e"]);
    const trigger: SweepTrigger = vi.fn().mockResolvedValue({ outcome: "fired" });

    const result = await sweepPendingFiles(access, trigger, {
      asOf: new Date("2026-10-07T00:00:00.000Z"),
      fileLimit: 3,
      budgetMs: 10_000,
      clock: fixedClock(),
    });

    expect(trigger).toHaveBeenCalledTimes(3);
    expect(result.firedCount).toBe(3);
    expect(result.deferredCount).toBe(2);
    expect(result.files.filter((f) => f.outcome === "deferred").map((f) => f.id)).toEqual(["d", "e"]);
  });

  it("stops starting new work once the wall-clock budget is exhausted, reporting the remainder as deferred", async () => {
    const access = makeFakeSweepAccess(["a", "b", "c"]);
    const trigger: SweepTrigger = vi.fn().mockResolvedValue({ outcome: "fired" });
    // clock() is called once to record startedAt, then once per loop
    // iteration's budget check. Budget of 100ms; the second check (before
    // "b") reports 150ms elapsed, so "a" fires and "b"/"c" are deferred.
    const readings = [0, 0, 150];
    let i = 0;
    const clock = () => readings[Math.min(i++, readings.length - 1)];

    const result = await sweepPendingFiles(access, trigger, {
      asOf: new Date("2026-10-07T00:00:00.000Z"),
      fileLimit: 3,
      budgetMs: 100,
      clock,
    });

    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith("a");
    expect(result.files).toEqual([
      { id: "a", outcome: "fired" },
      { id: "b", outcome: "deferred" },
      { id: "c", outcome: "deferred" },
    ]);
  });

  it("a trigger that reports a failure does not stop the sweep: the remaining files are still fired and the failed one is reported as such", async () => {
    const access = makeFakeSweepAccess(["a", "b", "c"]);
    const trigger: SweepTrigger = vi
      .fn()
      .mockResolvedValueOnce({ outcome: "fired" })
      .mockResolvedValueOnce({ outcome: "failed", message: "background trigger responded 500" })
      .mockResolvedValueOnce({ outcome: "fired" });

    const result = await sweepPendingFiles(access, trigger, {
      asOf: new Date("2026-10-07T00:00:00.000Z"),
      fileLimit: 3,
      budgetMs: 10_000,
      clock: fixedClock(),
    });

    expect(trigger).toHaveBeenCalledTimes(3);
    expect(result.files).toEqual([
      { id: "a", outcome: "fired" },
      { id: "b", outcome: "failed" },
      { id: "c", outcome: "fired" },
    ]);
    expect(result.failedCount).toBe(1);
  });

  it("a trigger that reports not-configured is also reported as a sweep-level failed outcome, never fired", async () => {
    const access = makeFakeSweepAccess(["a"]);
    const trigger: SweepTrigger = vi.fn().mockResolvedValue({ outcome: "not-configured" });

    const result = await sweepPendingFiles(access, trigger, {
      asOf: new Date("2026-10-07T00:00:00.000Z"),
      fileLimit: 1,
      budgetMs: 10_000,
      clock: fixedClock(),
    });

    expect(result.files).toEqual([{ id: "a", outcome: "failed" }]);
  });

  it("a trigger that throws is caught and reported as errored, and the loop continues", async () => {
    const access = makeFakeSweepAccess(["a", "b"]);
    const trigger: SweepTrigger = vi
      .fn()
      .mockRejectedValueOnce(new Error("network exploded"))
      .mockResolvedValueOnce({ outcome: "fired" });

    const result = await sweepPendingFiles(access, trigger, {
      asOf: new Date("2026-10-07T00:00:00.000Z"),
      fileLimit: 2,
      budgetMs: 10_000,
      clock: fixedClock(),
    });

    expect(trigger).toHaveBeenCalledTimes(2);
    expect(result.files).toEqual([
      { id: "a", outcome: "errored" },
      { id: "b", outcome: "fired" },
    ]);
    expect(result.erroredCount).toBe(1);
  });

  it("never claims, never downloads and never processes — only listSweepableFiles and the injected trigger are called", async () => {
    const access = makeFakeSweepAccess(["a"]);
    const trigger: SweepTrigger = vi.fn().mockResolvedValue({ outcome: "fired" });

    await sweepPendingFiles(access, trigger, {
      asOf: new Date("2026-10-07T00:00:00.000Z"),
      fileLimit: 1,
      budgetMs: 10_000,
      clock: fixedClock(),
    });

    expect(access.listSweepableFiles).toHaveBeenCalledTimes(1);
    expect(processClaimedFileMock).not.toHaveBeenCalled();
  });

  it("an empty sweepable list returns an empty result without firing anything at all", async () => {
    const access = makeFakeSweepAccess([]);
    const trigger: SweepTrigger = vi.fn();

    const result = await sweepPendingFiles(access, trigger, {
      asOf: new Date("2026-10-07T00:00:00.000Z"),
      fileLimit: 5,
      budgetMs: 10_000,
      clock: fixedClock(),
    });

    expect(trigger).not.toHaveBeenCalled();
    expect(result).toEqual({ files: [], firedCount: 0, failedCount: 0, deferredCount: 0, erroredCount: 0 });
  });
});
