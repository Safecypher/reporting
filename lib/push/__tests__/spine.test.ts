import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { acceptPush, type AcceptPushDeps } from "../delivery";
import { drainInbox, type DrainDeps } from "../drain";
import { generateToken } from "../tokens";
import { createSupabaseWriter } from "@/lib/ingestion/supabase-writer";
import { ingest } from "@/lib/ingestion";

const VERIFICATION_CSV =
  "CreatedAt,ExternalCardReference,Cvi2Value,duration,Authenticated\n" +
  "2026-08-13T01:23:37.823,525346UCgjCE5804,548,96.0686,False\n";
const verificationBytes = new TextEncoder().encode(VERIFICATION_CSV);

const OTHER_VERIFICATION_CSV =
  "CreatedAt,ExternalCardReference,Cvi2Value,duration,Authenticated\n" +
  "2026-08-13T02:00:00.000,999999XXXXXXXXX9999,111,10.0000,True\n";
const otherVerificationBytes = new TextEncoder().encode(OTHER_VERIFICATION_CSV);

const CREDENTIAL_ID = "11111111-1111-1111-1111-111111111111";

/** An in-memory `AcceptPushDeps` credential store, keyed by token hash. */
function makeFakeCredentialStore() {
  const credentials = new Map<string, { id: string; sender: string; revoked: boolean }>();
  const lastUsed = new Map<string, string>();

  return {
    addCredential(hash: string, id: string, sender: string) {
      credentials.set(hash, { id, sender, revoked: false });
    },
    revoke(hash: string) {
      const entry = credentials.get(hash);
      if (entry) entry.revoked = true;
    },
    lookupCredentialByTokenHash: vi.fn(async (tokenHash: string) => {
      const entry = credentials.get(tokenHash);
      if (!entry || entry.revoked) return null;
      return { id: entry.id, sender: entry.sender };
    }),
    touchLastUsed: vi.fn(async (credentialId: string) => {
      lastUsed.set(credentialId, new Date().toISOString());
    }),
    lastUsed,
  };
}

/**
 * An in-memory `push_rejections` recorder — plan 09-02's extension to
 * `AcceptPushDeps`. This file's tests care only that every `AcceptPushDeps`
 * literal satisfies the (now-extended) interface and that a rejection is
 * recorded when one is expected; the published reason-string contract itself
 * is covered by `lib/push/__tests__/delivery.test.ts`.
 */
function makeFakeRejectionRecorder() {
  const rejections: {
    credentialId: string;
    sender: string;
    filename: string;
    reason: string;
    byteSize: number;
  }[] = [];
  return {
    rejections,
    recordRejection: vi.fn(async (input: (typeof rejections)[number]) => {
      rejections.push(input);
    }),
  };
}

/** An in-memory inbox shared between `acceptPush`'s putObject and `drainInbox`'s list/download/remove. */
function makeFakeInbox() {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  return {
    objects,
    putObject: vi.fn(async (key: string, bytes: Uint8Array, contentType: string) => {
      // upsert:false in the real Storage call — a key clash surfaces as an
      // error rather than silently overwriting a sender's earlier file.
      if (objects.has(key)) throw new Error(`key collision: ${key}`);
      objects.set(key, { bytes, contentType });
    }),
    listPrefixes: vi.fn(async () => {
      const prefixes = new Set<string>();
      for (const key of objects.keys()) prefixes.add(key.split("/")[0]);
      return [...prefixes];
    }),
    listObjectsInPrefix: vi.fn(async (prefix: string) => {
      const names: string[] = [];
      for (const key of objects.keys()) {
        if (key.startsWith(`${prefix}/`)) names.push(key.slice(prefix.length + 1));
      }
      return names;
    }),
    downloadObject: vi.fn(async (key: string) => {
      const obj = objects.get(key);
      if (!obj) throw new Error(`not found: ${key}`);
      return obj.bytes;
    }),
    removeObject: vi.fn(async (key: string) => {
      objects.delete(key);
    }),
  };
}

/**
 * A minimal chainable fake mimicking the supabase-js surface
 * `createSupabaseWriter` calls, shared across MULTIPLE writer instances (one
 * client, many fresh writers — mirrors production: one Supabase client, a
 * fresh `createSupabaseWriter()` call per drained file). `ingested_files`
 * rows persist in this shared store so the SAME content-hash dedup
 * `ingest()` already relies on works correctly across separate writer
 * instances, exactly as it would against the real database.
 */
function makeFakeIngestSupabase() {
  // Keyed by content_sha256 -> { id, uploaded_at, report_type }
  const byHash = new Map<
    string,
    { id: string; uploaded_at: string; report_type: string | null; status: string }
  >();
  // Keyed by id -> the full recorded insert payload, for provenance assertions.
  const byId = new Map<string, Record<string, unknown>>();
  let nextId = 1;

  const storage = {
    from: () => ({
      upload: async () => ({ data: { path: "x" }, error: null }),
    }),
  };

  const from = (table: string) => {
    if (table === "ingested_files") {
      // quick-261005-kz3: findFileByHash now filters status='done' as well as
      // the hash, and recordFile upserts on content_sha256. This stub models
      // both, because the dedup assertion below depends on the real sequence:
      // the first file only becomes `done` when finalizeFile patches it, and
      // ONLY then does the second identical file short-circuit.
      const filters: Record<string, string> = {};
      const chainable = {
        eq: (col: string, val: string) => {
          filters[col] = val;
          return {
            ...chainable,
            maybeSingle: async () => {
              const row = byHash.get(filters.content_sha256);
              if (!row) return { data: null, error: null };
              if (filters.status && row.status !== filters.status) {
                return { data: null, error: null };
              }
              return { data: row, error: null };
            },
          };
        },
      };
      return {
        select: () => chainable,
        upsert: (payload: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              const sha = payload.content_sha256 as string;
              const existing = byHash.get(sha);
              const id = existing?.id ?? `file-${nextId++}`;
              byId.set(id, { id, ...payload });
              byHash.set(sha, {
                id,
                uploaded_at: new Date().toISOString(),
                report_type: (payload.report_type as string | null) ?? null,
                status: (payload.status as string) ?? "pending",
              });
              return { data: { id }, error: null };
            },
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async (_col: string, id: string) => {
            const row = byId.get(id);
            if (row) Object.assign(row, patch);
            // finalizeFile's status must reach the hash index too, or a
            // completed file would never short-circuit a later identical one.
            for (const entry of byHash.values()) {
              if (entry.id === id && typeof patch.status === "string") {
                entry.status = patch.status;
              }
            }
            return { error: null };
          },
        }),
      };
    }
    // verifications (and any other Wave-2 generic table) — a single-row
    // upsert stub is all this tracer needs; per-row de-dup is irrelevant
    // here since content_sha256 already short-circuits at the file level.
    // quick-261005-fd9: the writer awaits .upsert(...) directly and reads
    // `count` — it no longer chains .select("id").
    return {
      upsert: async (rows: Record<string, unknown>[]) => ({
        count: rows.length,
        error: null,
      }),
    };
  };

  return { from, storage, byId, byHash } as const;
}

describe("Phase 9 tracer: push -> inbox -> drain -> ingest", () => {
  it("proves the spine: the push response's reference equals the drained row's provenance reference", async () => {
    const { token, hash } = generateToken();
    const credStore = makeFakeCredentialStore();
    credStore.addCredential(hash, CREDENTIAL_ID, "TSYS");
    const inbox = makeFakeInbox();

    const deliveryDeps: AcceptPushDeps = {
      lookupCredentialByTokenHash: credStore.lookupCredentialByTokenHash,
      touchLastUsed: credStore.touchLastUsed,
      putObject: inbox.putObject,
      recordRejection: makeFakeRejectionRecorder().recordRejection,
    };

    const pushResult = await acceptPush(deliveryDeps, {
      authorizationHeader: `Bearer ${token}`,
      declaredContentLength: verificationBytes.length,
      files: [{ filename: "daily-ver-report_2026-08-13.csv", bytes: verificationBytes }],
    });

    expect(pushResult.status).toBe(202);
    expect(pushResult.results).toHaveLength(1);
    expect(pushResult.results[0].accepted).toBe(true);
    const reference = pushResult.results[0].reference;
    expect(reference).toBeTruthy();
    expect(reference).toContain(CREDENTIAL_ID);

    const ingestSupabase = makeFakeIngestSupabase();
    const capturedIngestCalls: { key: string }[] = [];

    const drainDeps: DrainDeps = {
      tryAcquireLock: vi.fn(async () => true),
      releaseLock: vi.fn(async () => {}),
      listPrefixes: inbox.listPrefixes,
      listObjectsInPrefix: inbox.listObjectsInPrefix,
      downloadObject: inbox.downloadObject,
      removeObject: inbox.removeObject,
      ingestOne: vi.fn(async (key: string, bytes: Uint8Array) => {
        capturedIngestCalls.push({ key });
        const writer = createSupabaseWriter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ingestSupabase as any,
          { source: "push", sourceRef: key, sourceCredentialId: CREDENTIAL_ID }
        );
        const fileName = key.split("/").pop() ?? key;
        return ingest({ fileName, bytes, contentType: undefined, uploadedBy: null }, writer);
      }),
    };

    const drainResult = await drainInbox(drainDeps);

    expect(drainResult.status).toBe(200);
    expect(drainResult.processed).toBe(1);
    expect(capturedIngestCalls).toEqual([{ key: reference }]);
    // Removed from the inbox after a terminal outcome.
    expect(inbox.objects.size).toBe(0);

    // The single string tying the sender's receipt to the normalised row.
    const recordedRows = [...ingestSupabase.byId.values()];
    expect(recordedRows).toHaveLength(1);
    expect(recordedRows[0].source).toBe("push");
    expect(recordedRows[0].source_ref).toBe(reference);
    expect(recordedRows[0].source_credential_id).toBe(CREDENTIAL_ID);
  });

  it("constructs a fresh writer per file — two distinct source_ref values across two objects, never cross-wired", async () => {
    const { token, hash } = generateToken();
    const credStore = makeFakeCredentialStore();
    credStore.addCredential(hash, CREDENTIAL_ID, "TSYS");
    const inbox = makeFakeInbox();

    const pushResult = await acceptPush(
      {
        lookupCredentialByTokenHash: credStore.lookupCredentialByTokenHash,
        touchLastUsed: credStore.touchLastUsed,
        putObject: inbox.putObject,
        recordRejection: makeFakeRejectionRecorder().recordRejection,
      },
      {
        authorizationHeader: `Bearer ${token}`,
        declaredContentLength: verificationBytes.length + otherVerificationBytes.length,
        files: [
          { filename: "daily-ver-report_2026-08-13.csv", bytes: verificationBytes },
          { filename: "daily-ver-report_2026-08-13-b.csv", bytes: otherVerificationBytes },
        ],
      }
    );
    expect(pushResult.status).toBe(202);
    const [refA, refB] = pushResult.results.map((r) => r.reference!);
    expect(refA).not.toBe(refB);

    const ingestSupabase = makeFakeIngestSupabase();
    const drainResult = await drainInbox({
      tryAcquireLock: async () => true,
      releaseLock: async () => {},
      listPrefixes: inbox.listPrefixes,
      listObjectsInPrefix: inbox.listObjectsInPrefix,
      downloadObject: inbox.downloadObject,
      removeObject: inbox.removeObject,
      ingestOne: async (key, bytes) => {
        const writer = createSupabaseWriter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ingestSupabase as any,
          { source: "push", sourceRef: key, sourceCredentialId: CREDENTIAL_ID }
        );
        return ingest({ fileName: key.split("/").pop() ?? key, bytes, contentType: undefined, uploadedBy: null }, writer);
      },
    });

    expect(drainResult.processed).toBe(2);
    const rows = [...ingestSupabase.byId.values()];
    expect(rows).toHaveLength(2);
    const sourceRefs = rows.map((r) => r.source_ref).sort();
    expect(sourceRefs).toEqual([refA, refB].sort());
  });
});

describe("acceptPush auth", () => {
  function baseDeps(inbox = makeFakeInbox()) {
    const credStore = makeFakeCredentialStore();
    return {
      credStore,
      inbox,
      deps: {
        lookupCredentialByTokenHash: credStore.lookupCredentialByTokenHash,
        touchLastUsed: credStore.touchLastUsed,
        putObject: inbox.putObject,
        recordRejection: makeFakeRejectionRecorder().recordRejection,
      } satisfies AcceptPushDeps,
    };
  }

  it("no Authorization header answers 401", async () => {
    const { deps } = baseDeps();
    const result = await acceptPush(deps, {
      authorizationHeader: null,
      declaredContentLength: verificationBytes.length,
      files: [{ filename: "f.csv", bytes: verificationBytes }],
    });
    expect(result).toEqual({ status: 401, results: [] });
  });

  it("a malformed Authorization header answers 401", async () => {
    const { deps } = baseDeps();
    const result = await acceptPush(deps, {
      authorizationHeader: "Basic not-a-bearer-token",
      declaredContentLength: verificationBytes.length,
      files: [{ filename: "f.csv", bytes: verificationBytes }],
    });
    expect(result).toEqual({ status: 401, results: [] });
  });

  it("an unknown token and a revoked token answer 401 identically", async () => {
    const { token, hash } = generateToken();
    const { deps, credStore } = baseDeps();
    credStore.addCredential(hash, CREDENTIAL_ID, "TSYS");
    credStore.revoke(hash);

    const revokedResult = await acceptPush(deps, {
      authorizationHeader: `Bearer ${token}`,
      declaredContentLength: verificationBytes.length,
      files: [{ filename: "f.csv", bytes: verificationBytes }],
    });

    const { deps: unknownDeps } = baseDeps();
    const unknownResult = await acceptPush(unknownDeps, {
      authorizationHeader: "Bearer sc_live_totally-unknown-token",
      declaredContentLength: verificationBytes.length,
      files: [{ filename: "f.csv", bytes: verificationBytes }],
    });

    expect(revokedResult).toEqual({ status: 401, results: [] });
    expect(unknownResult).toEqual({ status: 401, results: [] });
    expect(revokedResult).toEqual(unknownResult);
  });
});

describe("acceptPush size limits (D-09)", () => {
  it("a declared content length one byte over the 25MB request cap refuses before any file is read", async () => {
    const inbox = makeFakeInbox();
    const credStore = makeFakeCredentialStore();
    const deps: AcceptPushDeps = {
      lookupCredentialByTokenHash: credStore.lookupCredentialByTokenHash,
      touchLastUsed: credStore.touchLastUsed,
      putObject: inbox.putObject,
      recordRejection: makeFakeRejectionRecorder().recordRejection,
    };

    const result = await acceptPush(deps, {
      authorizationHeader: "Bearer irrelevant",
      declaredContentLength: 25 * 1024 * 1024 + 1,
      files: [{ filename: "f.csv", bytes: verificationBytes }],
    });

    expect(result).toEqual({ status: 400, results: [] });
    expect(credStore.lookupCredentialByTokenHash).not.toHaveBeenCalled();
  });

  it("a declared content length exactly at the 25MB request cap proceeds", async () => {
    const { token, hash } = generateToken();
    const inbox = makeFakeInbox();
    const credStore = makeFakeCredentialStore();
    credStore.addCredential(hash, CREDENTIAL_ID, "TSYS");

    const result = await acceptPush(
      {
        lookupCredentialByTokenHash: credStore.lookupCredentialByTokenHash,
        touchLastUsed: credStore.touchLastUsed,
        putObject: inbox.putObject,
        recordRejection: makeFakeRejectionRecorder().recordRejection,
      },
      {
        authorizationHeader: `Bearer ${token}`,
        declaredContentLength: 25 * 1024 * 1024,
        files: [{ filename: "f.csv", bytes: verificationBytes }],
      }
    );

    expect(result.status).toBe(202);
  });

  it("a file one byte over the 5MB per-file cap is refused while its accepted sibling is not, and a file exactly at 5MB is accepted", async () => {
    const { token, hash } = generateToken();
    const inbox = makeFakeInbox();
    const credStore = makeFakeCredentialStore();
    credStore.addCredential(hash, CREDENTIAL_ID, "TSYS");

    const tooLarge = new Uint8Array(5 * 1024 * 1024 + 1);
    // Filled with a printable ASCII byte, not left zero — an all-zero buffer
    // would trip the 09-02 NUL-in-leading-kilobyte unrecognised-format check,
    // which is not what this boundary test exercises.
    const exactlyAtCap = new Uint8Array(5 * 1024 * 1024).fill(0x41);

    const rejectionRecorder = makeFakeRejectionRecorder();
    const result = await acceptPush(
      {
        lookupCredentialByTokenHash: credStore.lookupCredentialByTokenHash,
        touchLastUsed: credStore.touchLastUsed,
        putObject: inbox.putObject,
        recordRejection: rejectionRecorder.recordRejection,
      },
      {
        authorizationHeader: `Bearer ${token}`,
        declaredContentLength: tooLarge.length + exactlyAtCap.length,
        files: [
          { filename: "too-large.csv", bytes: tooLarge },
          { filename: "exactly-at-cap.csv", bytes: exactlyAtCap },
        ],
      }
    );

    expect(result.results).toHaveLength(2);
    expect(result.results[0].accepted).toBe(false);
    expect(result.results[0].reason).toBeTruthy();
    expect(rejectionRecorder.rejections).toHaveLength(1);
    expect(rejectionRecorder.rejections[0].filename).toBe("too-large.csv");
    expect(result.results[1].accepted).toBe(true);
    expect(result.results[1].reference).toBeTruthy();
    // Some accepted, some refused -> 207 Multi-Status (D-07, extended by 09-02).
    expect(result.status).toBe(207);
  });
});

describe("acceptPush ordering, adjacency and empty requests (D-06/D-07)", () => {
  it("two files with the same filename in one request yield two distinct references and inbox keys, positionally ordered", async () => {
    const { token, hash } = generateToken();
    const inbox = makeFakeInbox();
    const credStore = makeFakeCredentialStore();
    credStore.addCredential(hash, CREDENTIAL_ID, "TSYS");

    const fileA = new TextEncoder().encode("a,b,c\n1,2,3\n");
    const fileB = new TextEncoder().encode("a,b,c\n4,5,6\n");

    const result = await acceptPush(
      {
        lookupCredentialByTokenHash: credStore.lookupCredentialByTokenHash,
        touchLastUsed: credStore.touchLastUsed,
        putObject: inbox.putObject,
        recordRejection: makeFakeRejectionRecorder().recordRejection,
      },
      {
        authorizationHeader: `Bearer ${token}`,
        declaredContentLength: fileA.length + fileB.length,
        files: [
          { filename: "same.csv", bytes: fileA },
          { filename: "same.csv", bytes: fileB },
        ],
      }
    );

    expect(result.status).toBe(202);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].filename).toBe("same.csv");
    expect(result.results[1].filename).toBe("same.csv");
    expect(result.results[0].reference).not.toBe(result.results[1].reference);
    expect(inbox.objects.size).toBe(2);
  });

  it("zero file parts answers 400 with an empty result array, never 202", async () => {
    const { token, hash } = generateToken();
    const inbox = makeFakeInbox();
    const credStore = makeFakeCredentialStore();
    credStore.addCredential(hash, CREDENTIAL_ID, "TSYS");

    const result = await acceptPush(
      {
        lookupCredentialByTokenHash: credStore.lookupCredentialByTokenHash,
        touchLastUsed: credStore.touchLastUsed,
        putObject: inbox.putObject,
        recordRejection: makeFakeRejectionRecorder().recordRejection,
      },
      { authorizationHeader: `Bearer ${token}`, declaredContentLength: 0, files: [] }
    );

    expect(result).toEqual({ status: 400, results: [] });
  });
});

describe("drainInbox (AUTO-05)", () => {
  it("an empty inbox returns zero processed, releases the mutex, and is not an error", async () => {
    const releaseLock = vi.fn(async () => {});
    const result = await drainInbox({
      tryAcquireLock: async () => true,
      releaseLock,
      listPrefixes: async () => [],
      listObjectsInPrefix: async () => [],
      downloadObject: async () => new Uint8Array(),
      removeObject: async () => {},
      ingestOne: async () => ({}),
    });

    expect(result).toEqual({ status: 200, processed: 0, outcomes: [] });
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it("a held mutex returns 409 having made no Storage or ingest call", async () => {
    const listPrefixes = vi.fn(async () => []);
    const ingestOne = vi.fn(async () => ({}));
    const releaseLock = vi.fn(async () => {});

    const result = await drainInbox({
      tryAcquireLock: async () => false,
      releaseLock,
      listPrefixes,
      listObjectsInPrefix: async () => [],
      downloadObject: async () => new Uint8Array(),
      removeObject: async () => {},
      ingestOne,
    });

    expect(result).toEqual({ status: 409, processed: 0, outcomes: [] });
    expect(listPrefixes).not.toHaveBeenCalled();
    expect(ingestOne).not.toHaveBeenCalled();
    // A held-mutex short-circuit never even reaches the finally's release —
    // the lock was never acquired by this caller in the first place.
    expect(releaseLock).not.toHaveBeenCalled();
  });

  it("two identical-content objects in one drain run call ingest twice but produce exactly one recorded file, and both objects are removed (D-13)", async () => {
    const inbox = makeFakeInbox();
    // Two distinct keys under the same credential prefix, IDENTICAL bytes.
    await inbox.putObject(`${CREDENTIAL_ID}/20260925T060000Z-0-aaaa-daily.csv`, verificationBytes, "text/csv");
    await inbox.putObject(`${CREDENTIAL_ID}/20260925T060100Z-0-bbbb-daily.csv`, verificationBytes, "text/csv");

    const ingestSupabase = makeFakeIngestSupabase();
    const ingestOneSpy = vi.fn(async (key: string, bytes: Uint8Array) => {
      const writer = createSupabaseWriter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ingestSupabase as any,
        { source: "push", sourceRef: key, sourceCredentialId: CREDENTIAL_ID }
      );
      return ingest({ fileName: key.split("/").pop() ?? key, bytes, contentType: undefined, uploadedBy: null }, writer);
    });

    const result = await drainInbox({
      tryAcquireLock: async () => true,
      releaseLock: async () => {},
      listPrefixes: inbox.listPrefixes,
      listObjectsInPrefix: inbox.listObjectsInPrefix,
      downloadObject: inbox.downloadObject,
      removeObject: inbox.removeObject,
      ingestOne: ingestOneSpy,
    });

    expect(ingestOneSpy).toHaveBeenCalledTimes(2);
    expect(result.processed).toBe(2); // both terminal (the second is alreadyUploaded, not a throw)
    expect(ingestSupabase.byId.size).toBe(1); // exactly one recorded ingested_files row
    expect(inbox.objects.size).toBe(0); // both removed
  });

  it("processes objects in deterministic order — sender prefix ascending, then object name ascending", async () => {
    const inbox = makeFakeInbox();
    await inbox.putObject("zzzz-cred/b.csv", new Uint8Array([1]), "text/csv");
    await inbox.putObject("zzzz-cred/a.csv", new Uint8Array([2]), "text/csv");
    await inbox.putObject("aaaa-cred/b.csv", new Uint8Array([3]), "text/csv");

    const order: string[] = [];
    await drainInbox({
      tryAcquireLock: async () => true,
      releaseLock: async () => {},
      listPrefixes: inbox.listPrefixes,
      listObjectsInPrefix: inbox.listObjectsInPrefix,
      downloadObject: inbox.downloadObject,
      removeObject: inbox.removeObject,
      ingestOne: async (key) => {
        order.push(key);
        return {};
      },
    });

    expect(order).toEqual(["aaaa-cred/b.csv", "zzzz-cred/a.csv", "zzzz-cred/b.csv"]);
  });
});

describe("proxy.ts matcher guard", () => {
  it("excludes api/push and api/ingest/drain while still gating api/ingest, set-password, uploads and settings/senders", () => {
    const proxySource = readFileSync(path.join(process.cwd(), "proxy.ts"), "utf-8");
    const match = /matcher:\s*\[\s*"([^"]+)"/.exec(proxySource);
    if (!match) {
      throw new Error("Could not find proxy.ts's `matcher` array — has its shape changed?");
    }
    const matcherPattern = match[1];
    // Anchored at the start: the unanchored pattern can otherwise find a
    // spurious match later in a path string (e.g. at the second `/` inside
    // "/api/ingest/drain"), which would misreport an excluded path as
    // gated. Next's own matcher compilation anchors the full path; this
    // mirrors that for the purpose of this guard.
    const matcherRegex = new RegExp(`^${matcherPattern}`);

    expect(matcherRegex.test("/api/push")).toBe(false);
    expect(matcherRegex.test("/api/ingest/drain")).toBe(false);

    expect(matcherRegex.test("/api/ingest")).toBe(true);
    expect(matcherRegex.test("/set-password")).toBe(true);
    expect(matcherRegex.test("/uploads")).toBe(true);
    expect(matcherRegex.test("/settings/senders")).toBe(true);
  });
});
