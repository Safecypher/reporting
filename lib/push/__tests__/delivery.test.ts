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

// Task 3: the route's own dependencies are mocked so POST /api/push's real
// handler (app/api/push/route.ts) can be exercised directly, not just
// acceptPush — buildSecretClient is swapped for a fake in-memory client;
// every other export of lib/ingestion/supabase-writer (isXlsx,
// detectContentType, sanitiseFileName) stays the real implementation, since
// lib/push/delivery.ts itself imports those from the same module.
let routeSupabaseClient: unknown;
vi.mock("@/lib/ingestion/supabase-writer", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/ingestion/supabase-writer")>();
  return {
    ...actual,
    buildSecretClient: () => routeSupabaseClient,
  };
});

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

/**
 * A fake `SupabaseClient` surface for exercising `app/api/push/route.ts`'s
 * real POST handler directly (Task 3) — the `push_credentials` /
 * `push_rejections` table shapes and the `inbox` Storage bucket, all
 * in-memory. `buildSecretClient` is mocked to return this (see the
 * `vi.mock` above); `pushTable`'s `(client as any).from(table)` escape
 * hatch works unmodified against it.
 */
function makeFakeRouteSupabase(opts: { failRejectionInsert?: boolean } = {}) {
  const credentials = new Map<string, { id: string; sender: string; revoked: boolean }>();
  const touchedIds: string[] = [];
  const rejectionRows: Record<string, unknown>[] = [];
  const uploadedKeys: string[] = [];

  return {
    addCredential(hash: string, id: string, sender: string) {
      credentials.set(hash, { id, sender, revoked: false });
    },
    revoke(hash: string) {
      const entry = credentials.get(hash);
      if (entry) entry.revoked = true;
    },
    touchedIds,
    rejectionRows,
    uploadedKeys,
    client: {
      from(table: string) {
        if (table === "push_credentials") {
          return {
            select: () => ({
              eq: (_col: string, tokenHash: string) => ({
                is: (_col2: string, _val: null) => ({
                  maybeSingle: async () => {
                    const entry = credentials.get(tokenHash);
                    if (!entry || entry.revoked) return { data: null, error: null };
                    return { data: { id: entry.id, sender: entry.sender }, error: null };
                  },
                }),
              }),
            }),
            update: (_patch: Record<string, unknown>) => ({
              eq: async (_col: string, id: string) => {
                touchedIds.push(id);
                return { error: null };
              },
            }),
          };
        }
        if (table === "push_rejections") {
          return {
            insert: async (row: Record<string, unknown>) => {
              if (opts.failRejectionInsert) {
                return { error: new Error("simulated push_rejections insert failure") };
              }
              rejectionRows.push(row);
              return { error: null };
            },
          };
        }
        throw new Error(`unexpected table in route test fake: ${table}`);
      },
      storage: {
        from: (_bucket: string) => ({
          upload: async (key: string) => {
            uploadedKeys.push(key);
            return { error: null };
          },
        }),
      },
    },
  };
}

function buildPushRequest(opts: {
  authorization?: string | null;
  files?: { filename: string; bytes: Uint8Array }[];
}): Request {
  const formData = new FormData();
  for (const f of opts.files ?? []) {
    // BlobPart's typed-array overload wants an ArrayBuffer-backed view;
    // Uint8Array's generic buffer type is ArrayBufferLike (which also
    // admits SharedArrayBuffer), so a cast is needed here purely for the
    // type checker — every array in this test file is freshly allocated
    // with a real ArrayBuffer.
    formData.append("file", new File([f.bytes as unknown as BlobPart], f.filename));
  }
  const headers = new Headers();
  if (opts.authorization) headers.set("authorization", opts.authorization);
  return new Request("http://localhost/api/push", {
    method: "POST",
    body: formData,
    headers,
  });
}

describe("POST /api/push route — the five auth cases (D-10)", () => {
  it("a valid token is accepted and the credential's last-used timestamp is stamped", async () => {
    const { POST } = await import("@/app/api/push/route");
    const routeSupabase = makeFakeRouteSupabase();
    routeSupabaseClient = routeSupabase.client;
    const { token, hash } = generateToken();
    routeSupabase.addCredential(hash, CREDENTIAL_ID, SENDER);

    const response = await POST(
      buildPushRequest({
        authorization: `Bearer ${token}`,
        files: [{ filename: "a.csv", bytes: csvBytes("a,b\n1,2\n") }],
      })
    );

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].accepted).toBe(true);
    expect(routeSupabase.touchedIds).toEqual([CREDENTIAL_ID]);
  });

  it("a mixed batch through the route answers 207 with the documented per-file body shape, and a rejection row is durably recorded", async () => {
    const { POST } = await import("@/app/api/push/route");
    const routeSupabase = makeFakeRouteSupabase();
    routeSupabaseClient = routeSupabase.client;
    const { token, hash } = generateToken();
    routeSupabase.addCredential(hash, CREDENTIAL_ID, SENDER);

    const response = await POST(
      buildPushRequest({
        authorization: `Bearer ${token}`,
        files: [
          { filename: "good.csv", bytes: csvBytes("a,b\n1,2\n") },
          { filename: "empty.csv", bytes: new Uint8Array(0) },
        ],
      })
    );

    expect(response.status).toBe(207);
    const body = await response.json();
    expect(body).toEqual({
      results: [
        { filename: "good.csv", accepted: true, reference: expect.any(String) },
        { filename: "empty.csv", accepted: false, reason: REJECTION_REASON_EMPTY_FILE },
      ],
    });
    expect(routeSupabase.rejectionRows).toHaveLength(1);
    expect(routeSupabase.rejectionRows[0]).toMatchObject({
      credential_id: CREDENTIAL_ID,
      sender: SENDER,
      file_name: "empty.csv",
      reason: REJECTION_REASON_EMPTY_FILE,
      byte_size: 0,
    });
  });

  it("a revoked token answers 401 and never stamps last-used", async () => {
    const { POST } = await import("@/app/api/push/route");
    const routeSupabase = makeFakeRouteSupabase();
    routeSupabaseClient = routeSupabase.client;
    const { token, hash } = generateToken();
    routeSupabase.addCredential(hash, CREDENTIAL_ID, SENDER);
    routeSupabase.revoke(hash);

    const response = await POST(
      buildPushRequest({
        authorization: `Bearer ${token}`,
        files: [{ filename: "a.csv", bytes: csvBytes("a,b\n1,2\n") }],
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ results: [] });
    expect(routeSupabase.touchedIds).toEqual([]);
  });

  it("an unknown token answers 401 and never stamps last-used", async () => {
    const { POST } = await import("@/app/api/push/route");
    const routeSupabase = makeFakeRouteSupabase();
    routeSupabaseClient = routeSupabase.client;

    const response = await POST(
      buildPushRequest({
        authorization: "Bearer sc_live_totally-unknown-token",
        files: [{ filename: "a.csv", bytes: csvBytes("a,b\n1,2\n") }],
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ results: [] });
    expect(routeSupabase.touchedIds).toEqual([]);
  });

  it("a missing Authorization header answers 401", async () => {
    const { POST } = await import("@/app/api/push/route");
    routeSupabaseClient = makeFakeRouteSupabase().client;

    const response = await POST(
      buildPushRequest({ files: [{ filename: "a.csv", bytes: csvBytes("a,b\n1,2\n") }] })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ results: [] });
  });

  it("a malformed Authorization header answers 401", async () => {
    const { POST } = await import("@/app/api/push/route");
    routeSupabaseClient = makeFakeRouteSupabase().client;

    const response = await POST(
      buildPushRequest({
        authorization: "Basic not-a-bearer-token",
        files: [{ filename: "a.csv", bytes: csvBytes("a,b\n1,2\n") }],
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ results: [] });
  });

  it("a revoked token and an unknown token answer byte-identically — status, body and headers alike (D-10)", async () => {
    const { POST } = await import("@/app/api/push/route");

    const revokedRoute = makeFakeRouteSupabase();
    const { token: revokedToken, hash: revokedHash } = generateToken();
    revokedRoute.addCredential(revokedHash, CREDENTIAL_ID, SENDER);
    revokedRoute.revoke(revokedHash);
    routeSupabaseClient = revokedRoute.client;
    const revokedResponse = await POST(
      buildPushRequest({
        authorization: `Bearer ${revokedToken}`,
        files: [{ filename: "a.csv", bytes: csvBytes("a,b\n1,2\n") }],
      })
    );

    const unknownRoute = makeFakeRouteSupabase();
    routeSupabaseClient = unknownRoute.client;
    const unknownResponse = await POST(
      buildPushRequest({
        authorization: "Bearer sc_live_totally-unknown-token",
        files: [{ filename: "a.csv", bytes: csvBytes("a,b\n1,2\n") }],
      })
    );

    expect(revokedResponse.status).toBe(unknownResponse.status);
    expect(await revokedResponse.json()).toEqual(await unknownResponse.json());
    // No header distinguishes the two — an enumerating attacker learns
    // nothing by comparing them (D-10).
    const revokedHeaders = [...revokedResponse.headers.entries()].sort();
    const unknownHeaders = [...unknownResponse.headers.entries()].sort();
    expect(revokedHeaders).toEqual(unknownHeaders);
  });

  it("a failed push_rejections insert degrades to a server-side log, never a 500 for the sender", async () => {
    const { POST } = await import("@/app/api/push/route");
    const routeSupabase = makeFakeRouteSupabase({ failRejectionInsert: true });
    routeSupabaseClient = routeSupabase.client;
    const { token, hash } = generateToken();
    routeSupabase.addCredential(hash, CREDENTIAL_ID, SENDER);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(
      buildPushRequest({
        authorization: `Bearer ${token}`,
        files: [{ filename: "empty.csv", bytes: new Uint8Array(0) }],
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      results: [{ filename: "empty.csv", accepted: false, reason: REJECTION_REASON_EMPTY_FILE }],
    });
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(routeSupabase.rejectionRows).toHaveLength(0); // the simulated insert never actually landed a row

    consoleErrorSpy.mockRestore();
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

/**
 * Regression cover for two defects found when POST /api/push was first
 * exercised against the DEPLOYED site during plan 09-05 Task 3:
 *
 *   - a request with no body at all answered 500, because
 *     `request.formData()` throws on a non-multipart body and the throw was
 *     uncaught. The published contract has no 500 in it.
 *   - the body was buffered BEFORE the token was checked, so an
 *     unauthenticated caller could make the server parse up to 25MB of
 *     multipart before being refused — contradicting T-09-31's stated
 *     premise that an unauthenticated call is "a cheap 401 before any
 *     Storage or database work".
 *
 * Both are contract-visible to TSYS and Bit Addict, so both are pinned here.
 */
describe("POST /api/push route — request-level refusals never 500 (09-05 Task 3)", () => {
  it("a request with no body and no Authorization answers 401, not 500", async () => {
    const { POST } = await import("@/app/api/push/route");
    const routeSupabase = makeFakeRouteSupabase();
    routeSupabaseClient = routeSupabase.client;

    const response = await POST(
      new Request("http://localhost/api/push", { method: "POST" })
    );

    expect(response.status).toBe(401);
    expect((await response.json()).results).toEqual([]);
  });

  it("a request with a valid-looking token but a non-multipart body answers 400, not 500", async () => {
    const { POST } = await import("@/app/api/push/route");
    const routeSupabase = makeFakeRouteSupabase();
    routeSupabaseClient = routeSupabase.client;
    const { token, hash } = generateToken();
    routeSupabase.addCredential(hash, CREDENTIAL_ID, SENDER);

    const response = await POST(
      new Request("http://localhost/api/push", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: "{}",
      })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).results).toEqual([]);
  });

  it("an unauthenticated request is refused without the credential table ever being read", async () => {
    const { POST } = await import("@/app/api/push/route");
    const routeSupabase = makeFakeRouteSupabase();
    routeSupabaseClient = routeSupabase.client;

    const response = await POST(
      buildPushRequest({
        authorization: null,
        files: [{ filename: "a.csv", bytes: csvBytes("a,b\n1,2\n") }],
      })
    );

    expect(response.status).toBe(401);
    expect(routeSupabase.touchedIds).toEqual([]);
  });
});

/**
 * CR-01 (Phase 9 code review, Critical). The 25MB request cap was enforced
 * only from a client-supplied Content-Length header, and `Number(null ?? "")`
 * is `0` — so a request that simply OMITS the header (trivially, via chunked
 * transfer-encoding) produced a finite, under-cap `0` and skipped BOTH the
 * route's pre-buffer guard and acceptPush's own declaredContentLength check.
 *
 * Worse, the credential lookup ran only AFTER the body was buffered, so a
 * caller with no valid credential at all could force unbounded buffering
 * before receiving its 401 — contradicting T-09-31's stated premise that an
 * unauthenticated call is "a cheap 401 before any Storage or database work".
 *
 * These pin the two halves of the fix: the cap is now measured while reading,
 * and authentication completes before the body is touched at all.
 */
describe("POST /api/push route — the request cap and auth ordering (CR-01)", () => {
  it("an over-cap body with NO Content-Length is refused 400, not silently accepted", async () => {
    const { POST } = await import("@/app/api/push/route");
    const routeSupabase = makeFakeRouteSupabase();
    routeSupabaseClient = routeSupabase.client;
    const { token, hash } = generateToken();
    routeSupabase.addCredential(hash, CREDENTIAL_ID, SENDER);

    // A streamed body with no Content-Length, deliberately over the 25MB cap.
    const CHUNK = new Uint8Array(1024 * 1024);
    let emitted = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted >= 26) {
          controller.close();
          return;
        }
        emitted += 1;
        controller.enqueue(CHUNK);
      },
    });

    const request = new Request("http://localhost/api/push", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "multipart/form-data; boundary=----cr01",
      },
      body,
      // @ts-expect-error duplex is required for a streaming body in undici
      duplex: "half",
    });

    expect(request.headers.get("content-length")).toBeNull();

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect((await response.json()).results).toEqual([]);
    // Nothing was stored — the cap tripped before any Storage write.
    expect(routeSupabase.uploadedKeys).toEqual([]);
  });

  it("an unknown token is refused without the request body ever being consumed", async () => {
    const { POST } = await import("@/app/api/push/route");
    const routeSupabase = makeFakeRouteSupabase();
    routeSupabaseClient = routeSupabase.client;
    // Deliberately register NO credential — this token is unknown.
    const { token } = generateToken();

    const request = buildPushRequest({
      authorization: `Bearer ${token}`,
      files: [{ filename: "a.csv", bytes: csvBytes("a,b\n1,2\n") }],
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect((await response.json()).results).toEqual([]);
    // The decisive assertion: the route never consumed the body. bodyUsed
    // flips only when something reads it, so a false here means the 401 was
    // issued before any buffering — T-09-31's "cheap 401" premise holding.
    expect(request.bodyUsed).toBe(false);
    expect(routeSupabase.uploadedKeys).toEqual([]);
    expect(routeSupabase.touchedIds).toEqual([]);
  });

  it("a revoked token is also refused without the body being consumed", async () => {
    const { POST } = await import("@/app/api/push/route");
    const routeSupabase = makeFakeRouteSupabase();
    routeSupabaseClient = routeSupabase.client;
    const { token, hash } = generateToken();
    routeSupabase.addCredential(hash, CREDENTIAL_ID, SENDER);
    routeSupabase.revoke(hash);

    const request = buildPushRequest({
      authorization: `Bearer ${token}`,
      files: [{ filename: "a.csv", bytes: csvBytes("a,b\n1,2\n") }],
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(request.bodyUsed).toBe(false);
    expect(routeSupabase.uploadedKeys).toEqual([]);
  });

  it("a normal under-cap push still works end to end after the reordering", async () => {
    const { POST } = await import("@/app/api/push/route");
    const routeSupabase = makeFakeRouteSupabase();
    routeSupabaseClient = routeSupabase.client;
    const { token, hash } = generateToken();
    routeSupabase.addCredential(hash, CREDENTIAL_ID, SENDER);

    const response = await POST(
      buildPushRequest({
        authorization: `Bearer ${token}`,
        files: [{ filename: "a.csv", bytes: csvBytes("a,b\n1,2\n") }],
      })
    );

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.results[0].accepted).toBe(true);
    expect(routeSupabase.uploadedKeys).toHaveLength(1);
  });
});
