import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  claimManualUpload,
  claimOutcomeToResponse,
  type ClaimUploadDeps,
  type ClaimUploadOutcome,
} from "../claim-upload";
import { buildManualObjectKey, type InboxObjectOutcome } from "../inbox-object";
import type { IngestionResult } from "../types";

/**
 * The pure claim core (14-01 Task 2), driven with plain vi.fn fakes: no
 * Supabase client anywhere. Pins the order of the safety steps, both
 * server-side size measurements, and the exact status code and body of every
 * outcome.
 */

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const KEY = buildManualObjectKey(USER, "report.csv", new Date("2026-10-20T10:15:00Z"), "0123456789abcdef");

const PENDING: InboxObjectOutcome = { kind: "pending", ingestedFileId: "file-1", reportType: "verification" };

type DepMocks = { [K in keyof ClaimUploadDeps]: ReturnType<typeof vi.fn> };

function makeDeps(overrides: Partial<ClaimUploadDeps> = {}) {
  const deps = {
    getObjectSize: vi.fn(async () => ({ found: true as const, size: 10 })),
    download: vi.fn(async () => new Uint8Array(10)),
    remove: vi.fn(async () => {}),
    ingestOne: vi.fn(async () => PENDING),
    ...overrides,
  };
  return deps as unknown as ClaimUploadDeps & DepMocks;
}

function totalCalls(deps: DepMocks): number {
  return (
    deps.getObjectSize.mock.calls.length +
    deps.download.mock.calls.length +
    deps.remove.mock.calls.length +
    deps.ingestOne.mock.calls.length
  );
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("claimManualUpload - size guards (P14-03)", () => {
  it("pins the transfer ceiling at 52,428,800 bytes (50 MiB, D-20)", () => {
    expect(MAX_UPLOAD_BYTES).toBe(52_428_800);
  });

  it("removes the object and answers too-large when Storage metadata size is MAX + 1, never downloading", async () => {
    const deps = makeDeps({ getObjectSize: vi.fn(async () => ({ found: true as const, size: MAX_UPLOAD_BYTES + 1 })) });

    const outcome = await claimManualUpload({ key: KEY, sessionUserId: USER }, deps);

    expect(outcome.kind).toBe("too-large");
    expect(deps.remove).toHaveBeenCalledExactlyOnceWith(KEY);
    expect(deps.download).not.toHaveBeenCalled();
    expect(deps.ingestOne).not.toHaveBeenCalled();
  });

  it("proceeds when the metadata size is exactly MAX_UPLOAD_BYTES", async () => {
    const deps = makeDeps({ getObjectSize: vi.fn(async () => ({ found: true as const, size: MAX_UPLOAD_BYTES })) });

    const outcome = await claimManualUpload({ key: KEY, sessionUserId: USER }, deps);

    expect(outcome.kind).toBe("pending");
    expect(deps.download).toHaveBeenCalledTimes(1);
  });

  it("downloads when the metadata size is unknown, then refuses a byte length of MAX + 1 without ingesting", async () => {
    const deps = makeDeps({
      getObjectSize: vi.fn(async () => ({ found: true as const, size: null })),
      download: vi.fn(async () => new Uint8Array(MAX_UPLOAD_BYTES + 1)),
    });

    const outcome = await claimManualUpload({ key: KEY, sessionUserId: USER }, deps);

    expect(outcome.kind).toBe("too-large");
    expect(deps.download).toHaveBeenCalledTimes(1);
    expect(deps.remove).toHaveBeenCalledExactlyOnceWith(KEY);
    expect(deps.ingestOne).not.toHaveBeenCalled();
  });

  it("still answers too-large when removing the oversize object fails", async () => {
    const deps = makeDeps({
      getObjectSize: vi.fn(async () => ({ found: true as const, size: MAX_UPLOAD_BYTES + 1 })),
      remove: vi.fn(async () => {
        throw new Error("storage down");
      }),
    });

    const outcome = await claimManualUpload({ key: KEY, sessionUserId: USER }, deps);

    expect(outcome.kind).toBe("too-large");
  });

  it("never lets the browser-supplied file name influence a size or type decision", async () => {
    const bytes = new Uint8Array(10);
    const deps = makeDeps({ download: vi.fn(async () => bytes) });

    const outcome = await claimManualUpload({ key: KEY, sessionUserId: USER, fileName: "huge.xlsx" }, deps);

    expect(outcome.kind).toBe("pending");
    // "huge.xlsx" does not sanitise to the minted name, so the display name
    // stays the one bound to the key: the object is processed as the CSV it is.
    expect(deps.ingestOne).toHaveBeenCalledExactlyOnceWith(KEY, bytes, "report.csv");
  });
});

describe("claimManualUpload - authorisation and the calm not-found path (P14-02)", () => {
  it.each([
    ["a malformed key", "manual/not-a-real-key.csv"],
    ["a nested key", `manual/${USER}/20261020T101500Z-0123456789abcdef-report.csv`],
    ["a key with no manual prefix", KEY.replace(/^manual\//, "inbox/")],
    ["a path traversal key", "manual/../../etc/passwd"],
    ["a foreign user's key", buildManualObjectKey(OTHER, "report.csv", new Date("2026-10-20T10:15:00Z"), "0123456789abcdef")],
  ])("answers not-found with zero deps calls for %s", async (_label, key) => {
    const deps = makeDeps();

    const outcome = await claimManualUpload({ key, sessionUserId: USER }, deps);

    expect(outcome.kind).toBe("not-found");
    expect(totalCalls(deps)).toBe(0);
  });

  it("matches an upper-case UUID in the key against the lower-case session id", async () => {
    const upperKey = KEY.replace(USER, USER.toUpperCase());
    const deps = makeDeps();

    const outcome = await claimManualUpload({ key: upperKey, sessionUserId: USER }, deps);

    expect(outcome.kind).toBe("pending");
  });

  it("answers not-found when the object no longer exists (the double-claim case)", async () => {
    const deps = makeDeps({ getObjectSize: vi.fn(async () => ({ found: false as const })) });

    const outcome = await claimManualUpload({ key: KEY, sessionUserId: USER }, deps);

    expect(outcome.kind).toBe("not-found");
    expect(deps.download).not.toHaveBeenCalled();
    expect(deps.remove).not.toHaveBeenCalled();
    expect(deps.ingestOne).not.toHaveBeenCalled();
  });
});

describe("claimManualUpload - outcomes and the held-file contract (D-14, D-15)", () => {
  const ALREADY_UPLOADED: IngestionResult = {
    reportType: "verification",
    accepted: 0,
    duplicates: 0,
    rejected: 0,
    excluded: 0,
    rejectReasons: [],
    ingestedFileId: "file-9",
    alreadyUploaded: { date: "2026-10-01T08:30:00.000Z" },
  };
  const UNRECOGNISED: IngestionResult = {
    reportType: null,
    accepted: 0,
    duplicates: 0,
    rejected: 0,
    excluded: 0,
    rejectReasons: [{ row: 0, reasons: ["unrecognised report type"] }],
    ingestedFileId: "file-3",
  };

  it("maps an already-uploaded terminal to 200 with alreadyUploaded.date unchanged, and removes the object", async () => {
    const deps = makeDeps({ ingestOne: vi.fn(async () => ({ kind: "terminal" as const, result: ALREADY_UPLOADED })) });

    const outcome = await claimManualUpload({ key: KEY, sessionUserId: USER }, deps);
    const response = claimOutcomeToResponse(outcome);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(ALREADY_UPLOADED);
    expect((response.body as IngestionResult).alreadyUploaded?.date).toBe("2026-10-01T08:30:00.000Z");
    expect(deps.remove).toHaveBeenCalledExactlyOnceWith(KEY);
  });

  it("maps an unrecognised terminal to 200 with reportType null, and removes the object", async () => {
    const deps = makeDeps({ ingestOne: vi.fn(async () => ({ kind: "terminal" as const, result: UNRECOGNISED })) });

    const outcome = await claimManualUpload({ key: KEY, sessionUserId: USER }, deps);
    const response = claimOutcomeToResponse(outcome);

    expect(response.status).toBe(200);
    expect((response.body as IngestionResult).reportType).toBeNull();
    expect(deps.remove).toHaveBeenCalledExactlyOnceWith(KEY);
  });

  it("maps pending to 202 with today's pending body, and removes the object", async () => {
    const deps = makeDeps();

    const outcome = await claimManualUpload({ key: KEY, sessionUserId: USER }, deps);

    expect(claimOutcomeToResponse(outcome)).toEqual({
      status: 202,
      body: { fileId: "file-1", reportType: "verification", status: "pending" },
    });
    expect(deps.remove).toHaveBeenCalledExactlyOnceWith(KEY);
  });

  it.each([
    ["ingestOne", { ingestOne: vi.fn(async () => { throw new Error("ingest failed"); }) }],
    ["download", { download: vi.fn(async () => { throw new Error("download failed"); }) }],
    ["getObjectSize", { getObjectSize: vi.fn(async () => { throw new Error("info failed"); }) }],
  ])("answers received and never removes the object when %s throws", async (_name, override) => {
    const deps = makeDeps(override as Partial<ClaimUploadDeps>);

    const outcome = await claimManualUpload({ key: KEY, sessionUserId: USER }, deps);

    expect(outcome.kind).toBe("received");
    expect(claimOutcomeToResponse(outcome)).toEqual({ status: 202, body: { status: "received" } });
    expect(deps.remove).not.toHaveBeenCalled();
  });

  it("keeps the pending verdict when removing the inbox object fails afterwards", async () => {
    const deps = makeDeps({
      remove: vi.fn(async () => {
        throw new Error("storage down");
      }),
    });

    const outcome = await claimManualUpload({ key: KEY, sessionUserId: USER }, deps);

    expect(outcome.kind).toBe("pending");
  });
});

describe("claimManualUpload - timings", () => {
  it("records sizeMs, downloadMs, ingestMs, removeMs, totalMs and bytes from the injected clock", async () => {
    let clock = 0;
    const deps = makeDeps({ now: () => (clock += 10) });

    const outcome = await claimManualUpload({ key: KEY, sessionUserId: USER }, deps);

    expect(outcome.kind).toBe("pending");
    expect(outcome.timings).toEqual({
      sizeMs: 10,
      downloadMs: 10,
      ingestMs: 10,
      removeMs: 10,
      totalMs: 90,
      bytes: 10,
    });
  });
});

describe("claimOutcomeToResponse", () => {
  const timings = { totalMs: 1 };

  it.each<[ClaimUploadOutcome, number, unknown]>([
    [{ kind: "not-found", timings }, 404, { error: "Upload not found" }],
    [{ kind: "too-large", timings }, 413, { error: "File too large" }],
    [{ kind: "received", timings }, 202, { status: "received" }],
  ])("pins the status and body of %j", (outcome, status, body) => {
    expect(claimOutcomeToResponse(outcome)).toEqual({ status, body });
  });
});
