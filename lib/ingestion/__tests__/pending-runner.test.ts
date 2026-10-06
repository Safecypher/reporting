import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IngestDeps, IngestionResult, ReportType } from "../types";
import type { ClaimForProcessingResult, PendingFileAccess, PendingFileRow } from "../supabase-writer";

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
import { runPendingFile } from "../pending-runner";

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

  const access: PendingFileAccess = {
    loadPendingFile,
    claimForProcessing,
    downloadStoredBytes,
    releaseClaim,
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
