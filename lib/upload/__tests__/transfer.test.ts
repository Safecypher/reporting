import { describe, expect, it, vi, type Mock } from "vitest";

import {
  FILE_TOO_LARGE_MESSAGE,
  RECEIVED_MESSAGE,
  UPLOAD_FAILED_MESSAGE,
  UPLOAD_INTERRUPTED_MESSAGE,
  describeIngestFailure,
} from "../batch";
import {
  uploadViaStorage,
  type ClaimResponse,
  type MintResult,
  type TransferDeps,
} from "../transfer";

const MINT_OK: MintResult = { ok: true, path: "inbox/key-1", token: "tok-1" };

const RESULT_BODY = {
  reportType: null,
  accepted: 0,
  duplicates: 0,
  rejected: 0,
  excluded: 0,
  rejectReasons: [],
  ingestedFileId: null,
};

function makeDeps(overrides: Partial<TransferDeps> = {}) {
  const deps = {
    fileName: "billing.csv",
    mint: vi.fn<() => Promise<MintResult>>().mockResolvedValue(MINT_OK),
    put: vi.fn<(path: string, token: string) => Promise<boolean>>().mockResolvedValue(true),
    claim: vi
      .fn<(path: string) => Promise<ClaimResponse>>()
      .mockResolvedValue({
        status: 202,
        body: { fileId: "file-9", reportType: "billing", status: "pending" },
      }),
    onStage: vi.fn<(stage: "uploading" | "checking") => void>(),
    ...overrides,
  };
  return deps;
}

describe("uploadViaStorage: happy path", () => {
  it("mint, put and claim once each; claim 202 pending becomes a pending outcome", async () => {
    const deps = makeDeps();
    const outcome = await uploadViaStorage(deps);

    expect(outcome).toEqual({
      fileName: "billing.csv",
      kind: "pending",
      fileId: "file-9",
      reportType: "billing",
    });
    expect(deps.mint).toHaveBeenCalledTimes(1);
    expect(deps.put).toHaveBeenCalledTimes(1);
    expect(deps.put).toHaveBeenCalledWith("inbox/key-1", "tok-1");
    expect(deps.claim).toHaveBeenCalledTimes(1);
    expect(deps.claim).toHaveBeenCalledWith("inbox/key-1");
    expect((deps.onStage as Mock).mock.calls.map((c: unknown[]) => c[0])).toEqual(["uploading", "checking"]);
  });

  it("claim 200 with an IngestionResult body becomes a result outcome", async () => {
    const deps = makeDeps({
      claim: vi.fn().mockResolvedValue({ status: 200, body: RESULT_BODY }),
    });
    const outcome = await uploadViaStorage(deps);
    expect(outcome).toEqual({ fileName: "billing.csv", kind: "result", result: RESULT_BODY });
  });

  it("claim 200 already-uploaded result is carried through unchanged", async () => {
    const body = { ...RESULT_BODY, reportType: "billing", alreadyUploaded: { date: "2026-10-01" } };
    const deps = makeDeps({ claim: vi.fn().mockResolvedValue({ status: 200, body }) });
    const outcome = await uploadViaStorage(deps);
    expect(outcome.kind).toBe("result");
  });
});

describe("uploadViaStorage: retry once with a fresh URL (D-13)", () => {
  it("first put fails, second succeeds: mint twice, second put and claim use the second path and token", async () => {
    const mint = vi
      .fn<() => Promise<MintResult>>()
      .mockResolvedValueOnce({ ok: true, path: "inbox/key-1", token: "tok-1" })
      .mockResolvedValueOnce({ ok: true, path: "inbox/key-2", token: "tok-2" });
    const put = vi
      .fn<(path: string, token: string) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const deps = makeDeps({ mint, put });

    const outcome = await uploadViaStorage(deps);

    expect(mint).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenNthCalledWith(1, "inbox/key-1", "tok-1");
    expect(put).toHaveBeenNthCalledWith(2, "inbox/key-2", "tok-2");
    expect(deps.claim).toHaveBeenCalledTimes(1);
    expect(deps.claim).toHaveBeenCalledWith("inbox/key-2");
    expect(outcome.kind).toBe("pending");
  });

  it("both puts fail: failed with UPLOAD_INTERRUPTED_MESSAGE, mint exactly twice, claim never", async () => {
    const deps = makeDeps({ put: vi.fn().mockResolvedValue(false) });
    const outcome = await uploadViaStorage(deps);

    expect(outcome).toEqual({
      fileName: "billing.csv",
      kind: "failed",
      message: UPLOAD_INTERRUPTED_MESSAGE,
    });
    expect(deps.mint).toHaveBeenCalledTimes(2);
    expect(deps.claim).not.toHaveBeenCalled();
  });

  it("a put that throws counts as a failed put", async () => {
    const put = vi
      .fn<(path: string, token: string) => Promise<boolean>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(true);
    const deps = makeDeps({ put });
    const outcome = await uploadViaStorage(deps);
    expect(put).toHaveBeenCalledTimes(2);
    expect(outcome.kind).toBe("pending");

    const bothThrow = makeDeps({ put: vi.fn().mockRejectedValue(new Error("network")) });
    const failed = await uploadViaStorage(bothThrow);
    expect(failed).toEqual({
      fileName: "billing.csv",
      kind: "failed",
      message: UPLOAD_INTERRUPTED_MESSAGE,
    });
  });
});

describe("uploadViaStorage: mint failures", () => {
  it("mint 401: session-expired copy, put never called", async () => {
    const deps = makeDeps({ mint: vi.fn().mockResolvedValue({ ok: false, status: 401 }) });
    const outcome = await uploadViaStorage(deps);
    expect(outcome).toEqual({
      fileName: "billing.csv",
      kind: "failed",
      message: describeIngestFailure(401),
    });
    expect(deps.put).not.toHaveBeenCalled();
  });

  it("mint 413: FILE_TOO_LARGE_MESSAGE, put never called", async () => {
    const deps = makeDeps({ mint: vi.fn().mockResolvedValue({ ok: false, status: 413 }) });
    const outcome = await uploadViaStorage(deps);
    expect(outcome).toEqual({
      fileName: "billing.csv",
      kind: "failed",
      message: FILE_TOO_LARGE_MESSAGE,
    });
    expect(deps.put).not.toHaveBeenCalled();
  });

  it("mint 500 on the first attempt: UPLOAD_FAILED_MESSAGE", async () => {
    const deps = makeDeps({ mint: vi.fn().mockResolvedValue({ ok: false, status: 500 }) });
    const outcome = await uploadViaStorage(deps);
    expect(outcome).toEqual({
      fileName: "billing.csv",
      kind: "failed",
      message: UPLOAD_FAILED_MESSAGE,
    });
    expect(deps.put).not.toHaveBeenCalled();
  });

  it("mint answers 500 on the second attempt after a failed put: UPLOAD_INTERRUPTED_MESSAGE", async () => {
    const mint = vi
      .fn<() => Promise<MintResult>>()
      .mockResolvedValueOnce(MINT_OK)
      .mockResolvedValueOnce({ ok: false, status: 500 });
    const deps = makeDeps({ mint, put: vi.fn().mockResolvedValue(false) });
    const outcome = await uploadViaStorage(deps);
    expect(outcome).toEqual({
      fileName: "billing.csv",
      kind: "failed",
      message: UPLOAD_INTERRUPTED_MESSAGE,
    });
  });

  it("mint throws on the second attempt after a failed put: UPLOAD_INTERRUPTED_MESSAGE", async () => {
    const mint = vi
      .fn<() => Promise<MintResult>>()
      .mockResolvedValueOnce(MINT_OK)
      .mockRejectedValueOnce(new Error("offline"));
    const deps = makeDeps({ mint, put: vi.fn().mockResolvedValue(false) });
    const outcome = await uploadViaStorage(deps);
    expect(outcome).toEqual({
      fileName: "billing.csv",
      kind: "failed",
      message: UPLOAD_INTERRUPTED_MESSAGE,
    });
  });
});

describe("uploadViaStorage: a held file is never a failure (D-15)", () => {
  const receivedCases: [string, () => Promise<ClaimResponse>][] = [
    ["claim throws", () => Promise.reject(new Error("network"))],
    ["claim 500", () => Promise.resolve({ status: 500, body: {} })],
    ["claim 502", () => Promise.resolve({ status: 502, body: {} })],
    ["claim 504", () => Promise.resolve({ status: 504, body: {} })],
    ["claim 400", () => Promise.resolve({ status: 400, body: {} })],
    ["claim 401", () => Promise.resolve({ status: 401, body: {} })],
    ["claim 404", () => Promise.resolve({ status: 404, body: {} })],
    ["claim unparsable body (null)", () => Promise.resolve({ status: 200, body: null })],
    ["claim 202 received", () => Promise.resolve({ status: 202, body: { status: "received" } })],
  ];

  for (const [name, claim] of receivedCases) {
    it(`${name} returns received with RECEIVED_MESSAGE`, async () => {
      const deps = makeDeps({ claim: vi.fn(claim) });
      const outcome = await uploadViaStorage(deps);
      expect(outcome).toEqual({
        fileName: "billing.csv",
        kind: "received",
        message: RECEIVED_MESSAGE,
      });
      expect(deps.claim).toHaveBeenCalledTimes(1);
    });
  }

  it("claim 413 returns failed with FILE_TOO_LARGE_MESSAGE", async () => {
    const deps = makeDeps({
      claim: vi.fn().mockResolvedValue({ status: 413, body: { error: "File too large" } }),
    });
    const outcome = await uploadViaStorage(deps);
    expect(outcome).toEqual({
      fileName: "billing.csv",
      kind: "failed",
      message: FILE_TOO_LARGE_MESSAGE,
    });
  });
});

describe("uploadViaStorage: total function", () => {
  it("resolves (never rejects) with every dependency throwing", async () => {
    const boom = () => {
      throw new Error("boom");
    };
    const deps: TransferDeps = {
      fileName: "x.csv",
      mint: vi.fn(boom),
      put: vi.fn(boom),
      claim: vi.fn(boom),
      onStage: vi.fn(boom),
    };
    const outcome = await uploadViaStorage(deps);
    expect(outcome.fileName).toBe("x.csv");
    expect(outcome.kind).toBe("failed");
  });

  it("a throwing onStage callback does not change the outcome", async () => {
    const deps = makeDeps({
      onStage: vi.fn(() => {
        throw new Error("render crash");
      }),
    });
    const outcome = await uploadViaStorage(deps);
    expect(outcome.kind).toBe("pending");
  });
});
