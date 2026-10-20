import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { sha256 } from "@/lib/ingestion/hash";
import {
  FIXTURE_NAME,
  OTHER_USER_ID,
  TEST_USER_ID,
  loadVerificationFixture,
  makeFakeSecretClient,
  makeFakeStorageFetch,
  type FakeSecretClient,
} from "./inbox-fakes";

/**
 * Phase 14 tracer (14-01 Task 1): ONE CSV through every server layer the
 * storage-first upload introduces, driven against the REAL route handlers and
 * the REAL supabase-js signed-upload call. Only the network edges are faked:
 * the server-side session (mocked `@/lib/supabase/server`), the secret client
 * (swapped via `buildSecretClient`), the browser-side Storage transport, and
 * the global `fetch` the background trigger posts through.
 */

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  secretClient: null as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
}));

vi.mock("@/lib/ingestion/supabase-writer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ingestion/supabase-writer")>();
  return { ...actual, buildSecretClient: () => state.secretClient };
});

import { POST as mintPOST } from "@/app/api/ingest/upload-url/route";
import { POST as claimPOST } from "@/app/api/ingest/claim/route";

const SITE = "https://site.test";
const SECRET = "test-process-secret";
const FLAT_KEY_RE =
  /^manual\/\d{8}T\d{6}Z-11111111-1111-4111-8111-111111111111-[0-9a-f]{16}-daily-ver-report_2026-08-13\.csv$/;

function jsonRequest(url: string, body: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

let fake: FakeSecretClient;
let triggerCalls: string[];

beforeEach(() => {
  fake = makeFakeSecretClient();
  state.user = { id: TEST_USER_ID };
  state.secretClient = fake.client;
  triggerCalls = [];
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  process.env.INGEST_PROCESS_SECRET = SECRET;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url) === `${SITE}/.netlify/functions/ingest-process-background`) {
        triggerCalls.push(JSON.parse(String(init?.body)).fileId);
        return new Response(null, { status: 202 });
      }
      throw new Error(`unexpected fetch to ${String(url)}`);
    })
  );
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The browser-side half: a real supabase-js client whose Storage transport is the fake. */
function browserClient() {
  return createClient("https://fake.supabase.co", "publishable-test", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: makeFakeStorageFetch(fake) },
  });
}

async function mint(fileName = FIXTURE_NAME, size = 1234) {
  const res = await mintPOST(jsonRequest("/api/ingest/upload-url", { fileName, size }));
  return { res, body: (await res.json()) as { path: string; token: string } };
}

describe("storage-first upload tracer (mint -> signed PUT -> claim -> trigger)", () => {
  it("mints a flat inbox key and a signed upload token, never letting the browser choose the path", async () => {
    const { res, body } = await mint();

    expect(res.status).toBe(200);
    expect(body.path).toMatch(FLAT_KEY_RE);
    expect(body.path.split("/")).toHaveLength(2);
    expect(typeof body.token).toBe("string");
    expect(fake.signedCalls).toEqual([{ key: body.path, options: { upsert: false } }]);
  });

  it("lands the bytes in the inbox only through uploadToSignedUrl with the minted token", async () => {
    const bytes = loadVerificationFixture();
    const { body } = await mint();
    const storage = browserClient().storage.from("inbox");

    const rejected = await storage.uploadToSignedUrl(body.path, "not-the-minted-token", new Blob([bytes]));
    expect(rejected.error).not.toBeNull();
    expect(fake.inbox.has(body.path)).toBe(false);

    const accepted = await storage.uploadToSignedUrl(body.path, body.token, new Blob([bytes]));
    expect(accepted.error).toBeNull();
    expect(Array.from(fake.inbox.get(body.path) ?? [])).toEqual(Array.from(bytes));
  });

  it("claims the uploaded object: 202 pending, one trigger, inbox object gone, manual provenance from the key", async () => {
    const bytes = loadVerificationFixture();
    const { body } = await mint();
    const upload = await browserClient()
      .storage.from("inbox")
      .uploadToSignedUrl(body.path, body.token, new Blob([bytes]));
    expect(upload.error).toBeNull();

    const res = await claimPOST(jsonRequest("/api/ingest/claim", { path: body.path, fileName: FIXTURE_NAME }));
    const json = await res.json();

    expect(res.status).toBe(202);
    expect(json).toEqual({ fileId: "file-1", reportType: "verification", status: "pending" });
    expect(triggerCalls).toEqual(["file-1"]);
    expect(fake.inbox.has(body.path)).toBe(false);

    expect(fake.files.upserts).toHaveLength(1);
    expect(fake.files.upserts[0]).toMatchObject({
      source: "manual",
      uploaded_by: TEST_USER_ID,
      source_ref: null,
      source_credential_id: null,
      file_name: FIXTURE_NAME,
      report_type: "verification",
      status: "pending",
    });
    expect(fake.reportUploads.map((u) => u.path)).toEqual([`${sha256(bytes)}/${FIXTURE_NAME}`]);
  });

  it("answers 404 and touches no Storage at all for a well-formed key owned by another user", async () => {
    const foreignKey = `manual/20261020T101500Z-${OTHER_USER_ID}-0123456789abcdef-${FIXTURE_NAME}`;
    fake.inbox.set(foreignKey, loadVerificationFixture());

    const res = await claimPOST(jsonRequest("/api/ingest/claim", { path: foreignKey }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Upload not found" });
    expect(fake.calls.info).toBe(0);
    expect(fake.calls.download).toBe(0);
    expect(fake.calls.remove).toBe(0);
    expect(fake.inbox.has(foreignKey)).toBe(true);
  });

  it("answers 202 received and leaves the object in the inbox when the claim step itself throws (D-15)", async () => {
    const bytes = loadVerificationFixture();
    const { body } = await mint();
    await browserClient().storage.from("inbox").uploadToSignedUrl(body.path, body.token, new Blob([bytes]));
    fake.files.failUpsert = true;

    const res = await claimPOST(jsonRequest("/api/ingest/claim", { path: body.path, fileName: FIXTURE_NAME }));

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "received" });
    expect(fake.inbox.has(body.path)).toBe(true);
    expect(fake.calls.remove).toBe(0);
    expect(triggerCalls).toEqual([]);
  });

  it("answers 401 { error: Unauthorized } from both routes before reading the body", async () => {
    state.user = null;
    const mintReq = jsonRequest("/api/ingest/upload-url", { fileName: FIXTURE_NAME, size: 1 });
    const claimReq = jsonRequest("/api/ingest/claim", { path: "manual/x" });
    const mintSpy = vi.spyOn(mintReq, "json");
    const claimSpy = vi.spyOn(claimReq, "json");

    const mintRes = await mintPOST(mintReq);
    const claimRes = await claimPOST(claimReq);

    expect(mintRes.status).toBe(401);
    expect(await mintRes.json()).toEqual({ error: "Unauthorized" });
    expect(claimRes.status).toBe(401);
    expect(await claimRes.json()).toEqual({ error: "Unauthorized" });
    expect(mintSpy).not.toHaveBeenCalled();
    expect(claimSpy).not.toHaveBeenCalled();
    expect(fake.calls.createSignedUploadUrl).toBe(0);
  });
});
