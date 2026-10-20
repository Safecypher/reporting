import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { MAX_UPLOAD_BYTES } from "@/lib/ingestion/claim-upload";
import {
  MANUAL_PREFIX,
  buildManualObjectKey,
  ingestInboxObject,
  parseManualObjectKey,
  resolveManualDisplayName,
} from "@/lib/ingestion/inbox-object";
import type { TriggerBackgroundProcessingResult } from "@/lib/ingestion/process-trigger";
import {
  FIXTURE_NAME,
  OTHER_USER_ID,
  TEST_USER_ID,
  loadVerificationFixture,
  makeFakeSecretClient,
  type FakeSecretClient,
} from "./inbox-fakes";

/**
 * 14-01 Task 2: the key codec (P14-01), the shared per-object step's two
 * provenance branches (P14-06), and the mint route's edge cases (P14-01,
 * P14-03). The claim core lives in claim-upload.test.ts; the end-to-end
 * tracer in storage-upload.test.ts.
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

const FIXED_NOW = new Date("2026-10-20T10:15:30.123Z");
const NONCE = "0123456789abcdef";
const CREDENTIAL_ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("manual object key codec (P14-01, D-17)", () => {
  it("builds a flat key and parses it back to the same user id and sanitised name", () => {
    const key = buildManualObjectKey(TEST_USER_ID, "Daily Ver/Report.csv", FIXED_NOW, NONCE);

    expect(key).toBe(`manual/20261020T101530Z-${TEST_USER_ID}-${NONCE}-Daily_Ver_Report.csv`);
    expect(key.split("/")).toHaveLength(2);
    expect(parseManualObjectKey(key)).toEqual({
      mintedAt: "2026-10-20T10:15:30Z",
      userId: TEST_USER_ID,
      nonce: NONCE,
      fileName: "Daily_Ver_Report.csv",
    });
  });

  it("starts the text after the first slash with the basic-ISO timestamp and a hyphen, the shape the drain's parseDeliveredAt reads", () => {
    const key = buildManualObjectKey(TEST_USER_ID, FIXTURE_NAME, FIXED_NOW, NONCE);

    const afterPrefix = key.slice(key.indexOf("/") + 1);
    expect(afterPrefix).toMatch(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-/);
    expect(parseManualObjectKey(key)?.mintedAt).toBe("2026-10-20T10:15:30Z");
  });

  it("lower-cases an upper-case user id in the key and in the parsed result", () => {
    const key = buildManualObjectKey(TEST_USER_ID.toUpperCase(), FIXTURE_NAME, FIXED_NOW, NONCE);

    expect(key).toContain(TEST_USER_ID);
    expect(parseManualObjectKey(key)?.userId).toBe(TEST_USER_ID);
  });

  it("generates a fresh 16-hex nonce per key when none is supplied", () => {
    const a = parseManualObjectKey(buildManualObjectKey(TEST_USER_ID, FIXTURE_NAME));
    const b = parseManualObjectKey(buildManualObjectKey(TEST_USER_ID, FIXTURE_NAME));

    expect(a?.nonce).toMatch(/^[0-9a-f]{16}$/);
    expect(a?.nonce).not.toBe(b?.nonce);
  });

  it("refuses to mint a key for a user id that is not a UUID", () => {
    expect(() => buildManualObjectKey("not-a-uuid", FIXTURE_NAME)).toThrow();
  });

  it.each([
    ["a second slash", `manual/20261020T101530Z-${TEST_USER_ID}-${NONCE}-a/b.csv`],
    ["a nested user segment", `manual/${TEST_USER_ID}/20261020T101530Z-${NONCE}-a.csv`],
    ["a path traversal segment", `manual/../20261020T101530Z-${TEST_USER_ID}-${NONCE}-a.csv`],
    ["a non-UUID user", `manual/20261020T101530Z-not-a-uuid-${NONCE}-a.csv`],
    ["a 15-hex nonce", `manual/20261020T101530Z-${TEST_USER_ID}-0123456789abcde-a.csv`],
    ["a 17-hex nonce", `manual/20261020T101530Z-${TEST_USER_ID}-0123456789abcdef0-a.csv`],
    ["an upper-case nonce", `manual/20261020T101530Z-${TEST_USER_ID}-0123456789ABCDEF-a.csv`],
    ["no manual prefix", `inbox/20261020T101530Z-${TEST_USER_ID}-${NONCE}-a.csv`],
    ["the push credential shape", `${CREDENTIAL_ID}/20261020T101530Z-0-abcd1234-a.csv`],
    ["an empty name", `manual/20261020T101530Z-${TEST_USER_ID}-${NONCE}-`],
    ["a name with a space", `manual/20261020T101530Z-${TEST_USER_ID}-${NONCE}-a b.csv`],
  ])("parse rejects %s", (_label, key) => {
    expect(parseManualObjectKey(key)).toBeNull();
  });

  it("binds the display name to the minted key", () => {
    const parsed = parseManualObjectKey(buildManualObjectKey(TEST_USER_ID, "Daily Ver.csv", FIXED_NOW, NONCE))!;

    expect(resolveManualDisplayName(parsed, "Daily Ver.csv")).toBe("Daily Ver.csv");
    expect(resolveManualDisplayName(parsed, "Something Else.csv")).toBe("Daily_Ver.csv");
    expect(resolveManualDisplayName(parsed, undefined)).toBe("Daily_Ver.csv");
  });
});

describe("ingestInboxObject - the one per-object step (P14-06, D-08)", () => {
  let fake: FakeSecretClient;
  let trigger: ReturnType<typeof vi.fn<(fileId: string) => Promise<TriggerBackgroundProcessingResult>>>;
  const supabase = () => fake.client as unknown as SupabaseClient<Database>;

  beforeEach(() => {
    fake = makeFakeSecretClient();
    trigger = vi.fn(async () => ({ outcome: "fired" as const }));
  });

  it("records push provenance for a push key: source push, source_ref the key, credential from the leading UUID, uploaded_by null", async () => {
    const key = `${CREDENTIAL_ID}/20261020T101530Z-0-abcd1234-${FIXTURE_NAME}`;

    const outcome = await ingestInboxObject({ key, bytes: loadVerificationFixture() }, { supabase: supabase(), trigger });

    expect(outcome).toEqual({ kind: "pending", ingestedFileId: "file-1", reportType: "verification" });
    expect(fake.files.upserts).toHaveLength(1);
    expect(fake.files.upserts[0]).toMatchObject({
      source: "push",
      source_ref: key,
      source_credential_id: CREDENTIAL_ID,
      uploaded_by: null,
      file_name: `20261020T101530Z-0-abcd1234-${FIXTURE_NAME}`,
    });
    expect(trigger).toHaveBeenCalledExactlyOnceWith("file-1");
  });

  it("records manual provenance for a manual key: source manual, no source_ref or credential, uploaded_by from the key", async () => {
    const key = buildManualObjectKey(TEST_USER_ID, FIXTURE_NAME, FIXED_NOW, NONCE);

    await ingestInboxObject(
      { key, bytes: loadVerificationFixture(), fileNameOverride: "Original Name.csv" },
      { supabase: supabase(), trigger }
    );

    expect(fake.files.upserts[0]).toMatchObject({
      source: "manual",
      source_ref: null,
      source_credential_id: null,
      uploaded_by: TEST_USER_ID,
      file_name: "Original Name.csv",
    });
  });

  it("falls back to the name in the key when no display name is supplied", async () => {
    const key = buildManualObjectKey(TEST_USER_ID, FIXTURE_NAME, FIXED_NOW, NONCE);

    await ingestInboxObject({ key, bytes: loadVerificationFixture() }, { supabase: supabase(), trigger });

    expect(fake.files.upserts[0]).toMatchObject({ file_name: FIXTURE_NAME, uploaded_by: TEST_USER_ID });
  });

  it("never lets one call's provenance leak into the next (a fresh writer per call)", async () => {
    const pushKey = `${CREDENTIAL_ID}/20261020T101530Z-0-abcd1234-${FIXTURE_NAME}`;
    const manualKey = buildManualObjectKey(OTHER_USER_ID, "other.csv", FIXED_NOW, NONCE);
    const secondFile = new TextEncoder().encode(
      "CreatedAt,ExternalCardReference,Cvi2Value,duration,Authenticated\n2026-08-14T01:00:00.000,AAAA1111BBBB2222,111,50.5,False\n"
    );

    await ingestInboxObject({ key: pushKey, bytes: loadVerificationFixture() }, { supabase: supabase(), trigger });
    await ingestInboxObject({ key: manualKey, bytes: secondFile }, { supabase: supabase(), trigger });

    expect(fake.files.upserts).toHaveLength(2);
    expect(fake.files.upserts[0]).toMatchObject({ source: "push", source_ref: pushKey });
    expect(fake.files.upserts[1]).toMatchObject({
      source: "manual",
      source_ref: null,
      source_credential_id: null,
      uploaded_by: OTHER_USER_ID,
    });
  });

  it.each<[string, TriggerBackgroundProcessingResult]>([
    ["failed", { outcome: "failed", message: "background trigger responded 500" }],
    ["not-configured", { outcome: "not-configured" }],
  ])("still returns pending, and logs, when the trigger reports %s", async (_name, result) => {
    const key = buildManualObjectKey(TEST_USER_ID, FIXTURE_NAME, FIXED_NOW, NONCE);
    const failing = vi.fn(async () => result);

    const outcome = await ingestInboxObject(
      { key, bytes: loadVerificationFixture() },
      { supabase: supabase(), trigger: failing, logLabel: "[claim]" }
    );

    expect(outcome.kind).toBe("pending");
    expect(console.error).toHaveBeenCalledWith(
      "[claim] background trigger did not fire",
      "file-1",
      result.outcome,
      result.outcome === "failed" ? result.message : undefined
    );
  });

  it("returns terminal and fires no trigger for a file nothing will parse", async () => {
    const key = buildManualObjectKey(TEST_USER_ID, "mystery.csv", FIXED_NOW, NONCE);
    const bytes = new TextEncoder().encode("foo,bar\n1,2\n");

    const outcome = await ingestInboxObject({ key, bytes }, { supabase: supabase(), trigger });

    expect(outcome.kind).toBe("terminal");
    if (outcome.kind === "terminal") expect(outcome.result.reportType).toBeNull();
    expect(trigger).not.toHaveBeenCalled();
  });

  it("returns terminal alreadyUploaded for a content hash already ingested, firing no trigger", async () => {
    const key = buildManualObjectKey(TEST_USER_ID, FIXTURE_NAME, FIXED_NOW, NONCE);
    const bytes = loadVerificationFixture();
    await ingestInboxObject({ key, bytes }, { supabase: supabase(), trigger });
    // Only a DONE row counts as already uploaded (findFileByHash), and a claimed
    // file stays pending until the background processor finalises it.
    await fake.client.from("ingested_files").update({ status: "done" }).eq("id", "file-1");
    trigger.mockClear();

    const outcome = await ingestInboxObject({ key, bytes }, { supabase: supabase(), trigger });

    expect(outcome.kind).toBe("terminal");
    if (outcome.kind === "terminal") expect(outcome.result.alreadyUploaded?.date).toBe("2026-10-20T10:00:00.000Z");
    expect(trigger).not.toHaveBeenCalled();
  });
});

describe("POST /api/ingest/upload-url - mint route edge cases (P14-01, P14-03)", () => {
  let fake: FakeSecretClient;

  beforeEach(() => {
    fake = makeFakeSecretClient();
    state.user = { id: TEST_USER_ID };
    state.secretClient = fake.client;
  });

  function mint(body: unknown) {
    return mintPOST(
      new Request("http://localhost/api/ingest/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      })
    );
  }

  it("answers 401 without a session and mints nothing", async () => {
    state.user = null;

    const res = await mint({ fileName: FIXTURE_NAME, size: 1 });

    expect(res.status).toBe(401);
    expect(fake.calls.createSignedUploadUrl).toBe(0);
  });

  it.each([
    ["a missing fileName", { size: 1 }],
    ["an empty fileName", { fileName: "", size: 1 }],
    ["a fileName over 255 characters", { fileName: "a".repeat(256), size: 1 }],
    ["a missing size", { fileName: FIXTURE_NAME }],
    ["a negative size", { fileName: FIXTURE_NAME, size: -1 }],
    ["a non-integer size", { fileName: FIXTURE_NAME, size: 1.5 }],
    ["a string size", { fileName: FIXTURE_NAME, size: "12" }],
    ["an unparsable body", "{not json"],
    ["a null body", "null"],
  ])("answers 400 for %s", async (_label, body) => {
    const res = await mint(body);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Bad request" });
    expect(fake.calls.createSignedUploadUrl).toBe(0);
  });

  it("answers 413 for an advertised size of MAX_UPLOAD_BYTES + 1 and mints nothing", async () => {
    const res = await mint({ fileName: FIXTURE_NAME, size: MAX_UPLOAD_BYTES + 1 });

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "File too large" });
    expect(fake.calls.createSignedUploadUrl).toBe(0);
  });

  it("answers 200 for exactly MAX_UPLOAD_BYTES, with upsert false and a manual key embedding the session user", async () => {
    const res = await mint({ fileName: FIXTURE_NAME, size: MAX_UPLOAD_BYTES });
    const body = (await res.json()) as { path: string; token: string };

    expect(res.status).toBe(200);
    expect(body.path.startsWith(`${MANUAL_PREFIX}/`)).toBe(true);
    expect(parseManualObjectKey(body.path)?.userId).toBe(TEST_USER_ID);
    expect(fake.signedCalls).toEqual([{ key: body.path, options: { upsert: false } }]);
  });

  it("answers 200 for a size of 0 and still passes upsert false", async () => {
    const res = await mint({ fileName: FIXTURE_NAME, size: 0 });

    expect(res.status).toBe(200);
    expect(fake.signedCalls[0].options).toEqual({ upsert: false });
  });

  it("answers 500 on a Storage error, and the response body never contains a token", async () => {
    fake.flags.signError = true;

    const res = await mint({ fileName: FIXTURE_NAME, size: 1 });
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: "Could not start upload" });
    expect(text).not.toMatch(/token/i);
  });

  it("answers 500 when the secret client cannot be built, without throwing", async () => {
    state.secretClient = null;

    const res = await mint({ fileName: FIXTURE_NAME, size: 1 });

    expect(res.status).toBe(500);
  });
});
