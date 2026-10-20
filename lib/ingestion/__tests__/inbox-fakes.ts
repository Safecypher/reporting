/**
 * Shared in-memory fakes for the storage-first upload tests (Phase 14).
 *
 * Not a test file (no `.test.` in the name) so Vitest does not collect it; the
 * `vi.mock` calls themselves must live in each test file, because Vitest
 * hoists them per file. What is shared here is only the fake Supabase secret
 * client, the fake Storage transport the browser-side supabase-js client
 * talks to, and the fixture bytes.
 *
 * Never real billing data: the uploaded bytes are the existing verification
 * fixture.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const TEST_USER_ID = "11111111-1111-4111-8111-111111111111";
export const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
export const FIXTURE_NAME = "daily-ver-report_2026-08-13.csv";

export function loadVerificationFixture(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(path.join(import.meta.dirname, "verification.fixture.csv")));
}

export interface FakeIngestedFilesState {
  /** Every upsert payload recordFile sent, in order. */
  upserts: Record<string, unknown>[];
  /** Every update patch finalizeFile sent. */
  updates: { patch: Record<string, unknown>; id: string }[];
  /** When set, the next upserts answer `{ error }` (the claim-step-throws case, D-15). */
  failUpsert: boolean;
}

/**
 * A fake Supabase secret client covering exactly what the manual-upload path
 * touches: `storage.from("inbox")` (createSignedUploadUrl / info / download /
 * remove over a Map), `storage.from("reports").upload`, and an
 * `ingested_files` table modelling findFileByHash (status-filtered) and
 * recordFile (upsert on content_sha256) the way spine.test.ts does.
 */
export function makeFakeSecretClient() {
  const inbox = new Map<string, Uint8Array>();
  const reportUploads: { path: string; bytes: Uint8Array }[] = [];
  const signedCalls: { key: string; options: unknown }[] = [];
  const tokenByPath = new Map<string, string>();
  const calls = { info: 0, download: 0, remove: 0, createSignedUploadUrl: 0 };
  const flags = { signError: false };
  let tokenCounter = 0;

  const files: FakeIngestedFilesState = { upserts: [], updates: [], failUpsert: false };
  const byHash = new Map<string, { id: string; uploaded_at: string; report_type: string | null; status: string }>();
  let nextId = 1;

  const inboxBucket = {
    createSignedUploadUrl: async (key: string, options?: unknown) => {
      calls.createSignedUploadUrl++;
      signedCalls.push({ key, options });
      if (flags.signError) {
        return { data: null, error: new Error("simulated storage failure") };
      }
      const token = `signed-token-${++tokenCounter}`;
      tokenByPath.set(key, token);
      return {
        data: {
          signedUrl: `https://fake.supabase.co/storage/v1/object/upload/sign/inbox/${key}?token=${token}`,
          token,
          path: key,
        },
        error: null,
      };
    },
    info: async (key: string) => {
      calls.info++;
      const bytes = inbox.get(key);
      if (!bytes) {
        // Mirrors Storage: an absent object answers HTTP 400 with statusCode "404".
        return {
          data: null,
          error: Object.assign(new Error("Object not found"), { statusCode: "404", status: 400 }),
        };
      }
      return { data: { name: key, size: bytes.byteLength }, error: null };
    },
    download: async (key: string) => {
      calls.download++;
      const bytes = inbox.get(key);
      if (!bytes) return { data: null, error: new Error(`not found: ${key}`) };
      return {
        data: {
          arrayBuffer: async () =>
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        },
        error: null,
      };
    },
    remove: async (keys: string[]) => {
      calls.remove++;
      for (const key of keys) inbox.delete(key);
      return { data: [], error: null };
    },
  };

  const reportsBucket = {
    upload: async (p: string, bytes: Uint8Array) => {
      reportUploads.push({ path: p, bytes });
      return { data: { path: p }, error: null };
    },
  };

  function ingestedFilesTable() {
    const filters: Record<string, unknown> = {};
    const chain = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return chain;
      },
      maybeSingle: async () => {
        const row = byHash.get(filters.content_sha256 as string);
        if (!row) return { data: null, error: null };
        if (filters.status && row.status !== filters.status) return { data: null, error: null };
        return { data: row, error: null };
      },
    };
    return {
      select: () => chain,
      upsert: (payload: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            if (files.failUpsert) {
              return { data: null, error: new Error("simulated ingested_files upsert failure") };
            }
            files.upserts.push(payload);
            const sha = payload.content_sha256 as string;
            const existing = byHash.get(sha);
            const id = existing?.id ?? `file-${nextId++}`;
            byHash.set(sha, {
              id,
              uploaded_at: "2026-10-20T10:00:00.000Z",
              report_type: (payload.report_type as string | null) ?? null,
              status: (payload.status as string) ?? "pending",
            });
            return { data: { id }, error: null };
          },
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: async (_col: string, id: string) => {
          files.updates.push({ patch, id });
          for (const entry of byHash.values()) {
            if (entry.id === id && typeof patch.status === "string") entry.status = patch.status;
          }
          return { error: null };
        },
      }),
    };
  }

  const client = {
    storage: {
      from: (bucket: string) => (bucket === "inbox" ? inboxBucket : reportsBucket),
    },
    from: (table: string) => {
      if (table === "ingested_files") return ingestedFilesTable();
      // Any report-row table (verifications etc.): the claim half never writes
      // rows, but a stub keeps an accidental call from crashing opaquely.
      return { upsert: async (rows: Record<string, unknown>[]) => ({ count: rows.length, error: null }) };
    },
  };

  /** Marks a recorded row done, as the background processor's finalizeFile would (only a done row dedups). */
  const markDone = (id: string) => {
    for (const entry of byHash.values()) {
      if (entry.id === id) entry.status = "done";
    }
  };

  return { client, inbox, reportUploads, signedCalls, tokenByPath, calls, flags, files, markDone };
}

export type FakeSecretClient = ReturnType<typeof makeFakeSecretClient>;

/**
 * The Storage transport the BROWSER-side supabase-js client is given
 * (`createClient(..., { global: { fetch } })`). It answers only the signed
 * upload endpoint, `PUT /storage/v1/object/upload/sign/inbox/{path}?token=`,
 * rejects any token other than the one the mint step issued for that path,
 * and stores the multipart file part in the fake inbox.
 */
export function makeFakeStorageFetch(fake: FakeSecretClient) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const match = /^\/storage\/v1\/object\/upload\/sign\/inbox\/(.+)$/.exec(url.pathname);
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (!match || init?.method !== "PUT") {
      return json(404, { message: "not found", statusCode: "404", error: "not_found" });
    }
    const objectPath = decodeURIComponent(match[1]);
    const presented = url.searchParams.get("token");
    if (!presented || fake.tokenByPath.get(objectPath) !== presented) {
      return json(403, { message: "invalid signature", statusCode: "403", error: "Unauthorized" });
    }
    const form = init.body as FormData;
    const part = form.get("");
    if (!(part instanceof Blob)) {
      return json(400, { message: "no file part", statusCode: "400", error: "invalid_request" });
    }
    fake.inbox.set(objectPath, new Uint8Array(await part.arrayBuffer()));
    return json(200, { Key: `inbox/${objectPath}` });
  };
}
