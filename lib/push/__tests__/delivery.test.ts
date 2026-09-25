/**
 * The published `POST /api/push` delivery contract under test (D-07/D-09/
 * D-11/D-13/D-14, AUTO-03): the status matrix, per-file reasons, positional
 * ordering, magic-byte format detection, size boundaries, and duplicate
 * acceptance. `lib/push/__tests__/spine.test.ts` covers the end-to-end
 * spine (push -> inbox -> drain -> ingest) and the auth/size-cap edge probes
 * carried over from plan 09-01 — this file is the delivery-response contract
 * plan 09-02 adds on top of that spine.
 */
import { describe, it, expect, vi } from "vitest";
import {
  acceptPush,
  REJECTION_REASON_EMPTY_FILE,
  REJECTION_REASON_TOO_LARGE,
  REJECTION_REASON_UNRECOGNISED_FORMAT,
  type AcceptPushDeps,
  type RejectionRecordInput,
} from "../delivery";
import { generateToken } from "../tokens";

const CREDENTIAL_ID = "22222222-2222-2222-2222-222222222222";
const SENDER = "TSYS";

/** ZIP local-file-header magic number — makes a byte array "look like" XLSX regardless of filename. */
const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);

function csvBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** A byte array with a NUL in its leading kilobyte — neither CSV nor XLSX. */
function binaryGarbageBytes(): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes.set([0x01, 0x02, 0x00, 0x03]); // NUL at index 2
  return bytes;
}

function makeFakeInbox() {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    objects,
    putObject: vi.fn(async (key: string, bytes: Uint8Array, contentType: string) => {
      if (objects.has(key)) throw new Error(`key collision: ${key}`);
      objects.set(key, { bytes, contentType });
    }),
  };
}

function makeFakeCredentialStore() {
  const credentials = new Map<string, { id: string; sender: string; revoked: boolean }>();
  return {
    addCredential(hash: string, id: string, sender: string) {
      credentials.set(hash, { id, sender, revoked: false });
    },
    lookupCredentialByTokenHash: vi.fn(async (tokenHash: string) => {
      const entry = credentials.get(tokenHash);
      if (!entry || entry.revoked) return null;
      return { id: entry.id, sender: entry.sender };
    }),
    touchLastUsed: vi.fn(async (_credentialId: string) => {}),
  };
}

function makeFakeRejectionRecorder() {
  const rejections: RejectionRecordInput[] = [];
  return {
    rejections,
    recordRejection: vi.fn(async (input: RejectionRecordInput) => {
      rejections.push(input);
    }),
  };
}

/**
 * Builds a full `AcceptPushDeps` wired to a valid, already-minted credential,
 * and returns the matching bearer token — generating the token once here
 * (rather than separately in each test) is what keeps the Authorization
 * header and the credential store's hash in sync.
 */
function makeDeps() {
  const { token, hash } = generateToken();
  const credStore = makeFakeCredentialStore();
  credStore.addCredential(hash, CREDENTIAL_ID, SENDER);
  const inbox = makeFakeInbox();
  const rejectionRecorder = makeFakeRejectionRecorder();
  const deps: AcceptPushDeps = {
    lookupCredentialByTokenHash: credStore.lookupCredentialByTokenHash,
    touchLastUsed: credStore.touchLastUsed,
    putObject: inbox.putObject,
    recordRejection: rejectionRecorder.recordRejection,
  };
  return { token, deps, inbox, rejectionRecorder, credStore };
}

describe("acceptPush status matrix (D-07)", () => {
  it("three good files answers 202", async () => {
    const { token, deps } = makeDeps();

    const result = await acceptPush(deps, {
      authorizationHeader: `Bearer ${token}`,
      declaredContentLength: 30,
      files: [
        { filename: "a.csv", bytes: csvBytes("a,b\n1,2\n") },
        { filename: "b.csv", bytes: csvBytes("a,b\n3,4\n") },
        { filename: "c.csv", bytes: csvBytes("a,b\n5,6\n") },
      ],
    });

    expect(result.status).toBe(202);
    expect(result.results.every((r) => r.accepted)).toBe(true);
  });

  it("two good and one empty answers 207", async () => {
    const { token, deps } = makeDeps();

    const result = await acceptPush(deps, {
      authorizationHeader: `Bearer ${token}`,
      declaredContentLength: 20,
      files: [
        { filename: "a.csv", bytes: csvBytes("a,b\n1,2\n") },
        { filename: "empty.csv", bytes: new Uint8Array(0) },
        { filename: "b.csv", bytes: csvBytes("a,b\n3,4\n") },
      ],
    });

    expect(result.status).toBe(207);
    expect(result.results.filter((r) => r.accepted)).toHaveLength(2);
    expect(result.results.filter((r) => !r.accepted)).toHaveLength(1);
  });

  it("one file that is empty answers 400", async () => {
    const { token, deps } = makeDeps();

    const result = await acceptPush(deps, {
      authorizationHeader: `Bearer ${token}`,
      declaredContentLength: 0,
      files: [{ filename: "empty.csv", bytes: new Uint8Array(0) }],
    });

    expect(result.status).toBe(400);
    expect(result.results).toEqual([
      { filename: "empty.csv", accepted: false, reason: REJECTION_REASON_EMPTY_FILE },
    ]);
  });

  it("zero file parts answers 400 with a full per-file result array — trivially empty here, never omitted", async () => {
    const { token, deps } = makeDeps();

    const result = await acceptPush(deps, {
      authorizationHeader: `Bearer ${token}`,
      declaredContentLength: 0,
      files: [],
    });

    expect(result).toEqual({ status: 400, results: [] });
  });
});

describe("acceptPush positional ordering with a rejection in the middle", () => {
  it("keeps index 1 as the second part when the middle file of three is rejected", async () => {
    const { token, deps } = makeDeps();

    const tooLarge = new Uint8Array(5 * 1024 * 1024 + 1);

    const result = await acceptPush(deps, {
      authorizationHeader: `Bearer ${token}`,
      declaredContentLength: tooLarge.length + 20,
      files: [
        { filename: "first.csv", bytes: csvBytes("a,b\n1,2\n") },
        { filename: "second-oversized.csv", bytes: tooLarge },
        { filename: "third.csv", bytes: csvBytes("a,b\n3,4\n") },
      ],
    });

    expect(result.status).toBe(207);
    expect(result.results).toHaveLength(3);
    expect(result.results[0].filename).toBe("first.csv");
    expect(result.results[0].accepted).toBe(true);
    expect(result.results[0].reference).toBeTruthy();
    expect(result.results[1].filename).toBe("second-oversized.csv");
    expect(result.results[1].accepted).toBe(false);
    expect(result.results[1].reason).toBe(REJECTION_REASON_TOO_LARGE);
    expect(result.results[2].filename).toBe("third.csv");
    expect(result.results[2].accepted).toBe(true);
    expect(result.results[2].reference).toBeTruthy();
  });
});

describe("acceptPush rejection reasons and durable recording", () => {
  it("an empty file produces the empty-file reason and exactly one push_rejections row", async () => {
    const { token, deps, rejectionRecorder } = makeDeps();

    const result = await acceptPush(deps, {
      authorizationHeader: `Bearer ${token}`,
      declaredContentLength: 0,
      files: [{ filename: "empty.csv", bytes: new Uint8Array(0) }],
    });

    expect(result.results[0].reason).toBe(REJECTION_REASON_EMPTY_FILE);
    expect(rejectionRecorder.rejections).toHaveLength(1);
    expect(rejectionRecorder.rejections[0]).toMatchObject({
      credentialId: CREDENTIAL_ID,
      sender: SENDER,
      filename: "empty.csv",
      reason: REJECTION_REASON_EMPTY_FILE,
      byteSize: 0,
    });
  });

  it("an over-size file produces the over-size reason and exactly one push_rejections row", async () => {
    const { token, deps, rejectionRecorder } = makeDeps();
    const tooLarge = new Uint8Array(5 * 1024 * 1024 + 1);

    const result = await acceptPush(deps, {
      authorizationHeader: `Bearer ${token}`,
      declaredContentLength: tooLarge.length,
      files: [{ filename: "too-big.csv", bytes: tooLarge }],
    });

    expect(result.results[0].reason).toBe(REJECTION_REASON_TOO_LARGE);
    expect(rejectionRecorder.rejections).toHaveLength(1);
    expect(rejectionRecorder.rejections[0]).toMatchObject({
      filename: "too-big.csv",
      reason: REJECTION_REASON_TOO_LARGE,
      byteSize: tooLarge.length,
    });
  });

  it("an unrecognised binary format produces the unrecognised-format reason and exactly one push_rejections row", async () => {
    const { token, deps, rejectionRecorder } = makeDeps();
    const garbage = binaryGarbageBytes();

    const result = await acceptPush(deps, {
      authorizationHeader: `Bearer ${token}`,
      declaredContentLength: garbage.length,
      files: [{ filename: "mystery.dat", bytes: garbage }],
    });

    expect(result.results[0].reason).toBe(REJECTION_REASON_UNRECOGNISED_FORMAT);
    expect(rejectionRecorder.rejections).toHaveLength(1);
    expect(rejectionRecorder.rejections[0]).toMatchObject({
      filename: "mystery.dat",
      reason: REJECTION_REASON_UNRECOGNISED_FORMAT,
    });
  });
});

describe("acceptPush size boundaries (D-09, adjacency)", () => {
  it("a one-byte file is accepted", async () => {
    const { token, deps } = makeDeps();

    const result = await acceptPush(deps, {
      authorizationHeader: `Bearer ${token}`,
      declaredContentLength: 1,
      files: [{ filename: "one-byte.csv", bytes: new Uint8Array([0x31]) }], // "1"
    });

    expect(result.status).toBe(202);
    expect(result.results[0].accepted).toBe(true);
  });

  it("a file of exactly 5,242,880 bytes is accepted", async () => {
    const { token, deps } = makeDeps();
    // Filled with a printable ASCII byte, not left zero — an all-zero buffer
    // would trip the NUL-in-leading-kilobyte unrecognised-format check below,
    // which is not what this boundary test is exercising.
    const exactlyAtCap = new Uint8Array(5 * 1024 * 1024).fill(0x41);

    const result = await acceptPush(deps, {
      authorizationHeader: `Bearer ${token}`,
      declaredContentLength: exactlyAtCap.length,
      files: [{ filename: "exact.csv", bytes: exactlyAtCap }],
    });

    expect(result.status).toBe(202);
    expect(result.results[0].accepted).toBe(true);
  });

  it("a file of 5,242,881 bytes is refused", async () => {
    const { token, deps } = makeDeps();
    const oneOver = new Uint8Array(5 * 1024 * 1024 + 1);

    const result = await acceptPush(deps, {
      authorizationHeader: `Bearer ${token}`,
      declaredContentLength: oneOver.length,
      files: [{ filename: "over.csv", bytes: oneOver }],
    });

    expect(result.status).toBe(400);
    expect(result.results[0].accepted).toBe(false);
    expect(result.results[0].reason).toBe(REJECTION_REASON_TOO_LARGE);
  });
});

describe("acceptPush magic-byte format detection (D-11)", () => {
  it("a file named with a spreadsheet extension whose bytes are plain text is accepted and typed as CSV", async () => {
    const { token, deps, inbox } = makeDeps();

    const result = await acceptPush(deps, {
      authorizationHeader: `Bearer ${token}`,
      declaredContentLength: 20,
      files: [{ filename: "report.xlsx", bytes: csvBytes("a,b\n1,2\n") }],
    });

    expect(result.results[0].accepted).toBe(true);
    const stored = inbox.objects.get(result.results[0].reference!);
    expect(stored?.contentType).toBe("text/csv");
  });

  it("a file named with a CSV extension whose bytes start with the ZIP magic number is accepted and typed as XLSX", async () => {
    const { token, deps, inbox } = makeDeps();

    const result = await acceptPush(deps, {
      authorizationHeader: `Bearer ${token}`,
      declaredContentLength: ZIP_MAGIC.length,
      files: [{ filename: "report.csv", bytes: ZIP_MAGIC }],
    });

    expect(result.results[0].accepted).toBe(true);
    const stored = inbox.objects.get(result.results[0].reference!);
    expect(stored?.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  });

  it("a file whose leading bytes contain a NUL is refused as unrecognised", async () => {
    const { token, deps } = makeDeps();

    const result = await acceptPush(deps, {
      authorizationHeader: `Bearer ${token}`,
      declaredContentLength: 16,
      files: [{ filename: "mystery.bin", bytes: binaryGarbageBytes() }],
    });

    expect(result.results[0].accepted).toBe(false);
    expect(result.results[0].reason).toBe(REJECTION_REASON_UNRECOGNISED_FORMAT);
  });
});

describe("acceptPush duplicate acceptance (D-13)", () => {
  it("pushing byte-identical content twice yields two accepted results with two distinct references and zero rejection rows", async () => {
    const { token, deps, rejectionRecorder } = makeDeps();
    const bytes = csvBytes("a,b\n1,2\n");

    const first = await acceptPush(deps, {
      authorizationHeader: `Bearer ${token}`,
      declaredContentLength: bytes.length,
      files: [{ filename: "daily.csv", bytes }],
    });
    const second = await acceptPush(deps, {
      authorizationHeader: `Bearer ${token}`,
      declaredContentLength: bytes.length,
      files: [{ filename: "daily.csv", bytes }],
    });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(first.results[0].accepted).toBe(true);
    expect(second.results[0].accepted).toBe(true);
    expect(first.results[0].reference).not.toBe(second.results[0].reference);
    expect(rejectionRecorder.rejections).toHaveLength(0);
  });
});

describe("acceptPush isolation — no rejection recorded on request-level refusals", () => {
  it("the rejection recorder is never called on the unauthenticated path", async () => {
    const { deps, rejectionRecorder } = makeDeps();

    const result = await acceptPush(deps, {
      authorizationHeader: null,
      declaredContentLength: 10,
      files: [{ filename: "a.csv", bytes: csvBytes("a,b\n1,2\n") }],
    });

    expect(result).toEqual({ status: 401, results: [] });
    expect(rejectionRecorder.recordRejection).not.toHaveBeenCalled();
  });

  it("the rejection recorder is never called on the request-too-large path", async () => {
    const { deps, rejectionRecorder } = makeDeps();

    const result = await acceptPush(deps, {
      authorizationHeader: "Bearer irrelevant",
      declaredContentLength: 25 * 1024 * 1024 + 1,
      files: [{ filename: "a.csv", bytes: csvBytes("a,b\n1,2\n") }],
    });

    expect(result).toEqual({ status: 400, results: [] });
    expect(rejectionRecorder.recordRejection).not.toHaveBeenCalled();
  });
});
