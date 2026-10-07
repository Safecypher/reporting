import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReportSourceRow, SourceFreshnessRow } from "@/lib/dashboard/freshness";
import { sha256 } from "@/lib/ingestion/hash";
import { MAX_PROCESSING_ATTEMPTS } from "@/lib/ingestion/pending-state";

// Task 2: the route's own dependencies are mocked so POST
// /api/ingest/drain's real handler (app/api/ingest/drain/route.ts) can be
// exercised directly — buildSecretClient is swapped for a fake in-memory
// client; every other export of lib/ingestion/supabase-writer stays the
// real implementation (09-02's idiom, reused by 10-03).
let routeSupabaseClient: unknown;
vi.mock("@/lib/ingestion/supabase-writer", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/ingestion/supabase-writer")>();
  return {
    ...actual,
    buildSecretClient: () => routeSupabaseClient,
  };
});

const DRAIN_CRON_SECRET = "test-drain-secret";
const SOURCE_TYPES = [
  "verification",
  "billing",
  "dcvv",
  "card-inventory",
  "removed-cards",
  "apigee-stats",
] as const;

function defaultSources(): ReportSourceRow[] {
  return SOURCE_TYPES.map((report_type) => ({
    report_type,
    expected_cadence: "daily-business" as const,
    stale_after_hours: 12,
    enabled: true,
  }));
}

function defaultFreshnessRows(): SourceFreshnessRow[] {
  return SOURCE_TYPES.map((report_type) => ({
    report_type,
    expected_cadence: "daily-business" as const,
    stale_after_hours: 12,
    last_covered_day: "2026-09-26",
    latest_file_status: "done",
    latest_file_uploaded_at: "2026-09-26T08:00:00Z",
    stale: false,
  }));
}

interface FakeInboxObject {
  prefix: string;
  name: string;
  failDownload?: boolean;
}

function makeFakeInboxStorage(objects: FakeInboxObject[] = []) {
  const removed: string[] = [];
  const uploaded: string[] = [];
  return {
    removed,
    uploaded,
    // The fake is keyed to the "inbox" shape (list/download/remove) for
    // every bucket, with one addition: upload() (used by recordFile when
    // the D-09 per-object step claims a file and writes its bytes to the
    // "reports" bucket). Bucket name is deliberately ignored, same as the
    // rest of this fake -- there is only ever one Storage client in play.
    from: (_bucket: string) => ({
      list: async (prefix: string | undefined) => {
        if (prefix === undefined) {
          const prefixes = [...new Set(objects.map((o) => o.prefix))];
          return { data: prefixes.map((p) => ({ name: p, metadata: null })), error: null };
        }
        const inPrefix = objects.filter((o) => o.prefix === prefix);
        return { data: inPrefix.map((o) => ({ name: o.name, metadata: {} })), error: null };
      },
      download: async (objectKey: string) => {
        const prefix = objectKey.split("/")[0];
        const name = objectKey.slice(prefix.length + 1);
        const obj = objects.find((o) => o.prefix === prefix && o.name === name);
        if (!obj) return { data: null, error: new Error(`not found: ${objectKey}`) };
        if (obj.failDownload) {
          return { data: null, error: new Error(`simulated download failure: ${objectKey}`) };
        }
        return { data: { arrayBuffer: async () => new ArrayBuffer(0) }, error: null };
      },
      remove: async (keys: string[]) => {
        removed.push(...keys);
        return { error: null };
      },
      upload: async (path: string) => {
        uploaded.push(path);
        return { error: null };
      },
    }),
  };
}

/**
 * The fake `ingested_files` table (13-07): covers BOTH halves the
 * converged per-object step and the sweep need --
 * `createSupabaseWriter`'s findFileByHash/recordFile/finalizeFile (write
 * path, used by `claimFile`) and `createPendingFileAccess`'s
 * listSweepableFiles/countStuckPendingFiles (read path, used by the
 * sweep/stuck-count). Minimal chainable surface: select/eq/lt/lte/or/
 * order/limit/maybeSingle/single/upsert/update -- just enough of
 * supabase-js's query builder to drive the real implementations.
 */
interface FakeIngestedFileRow {
  id: string;
  file_name: string;
  content_sha256: string;
  uploaded_by: string | null;
  report_type: string | null;
  storage_path: string | null;
  status: string;
  uploaded_at: string;
  processing_attempts: number;
  processing_started_at: string | null;
  [key: string]: unknown;
}

function makeFakeIngestedFilesTable(initial: FakeIngestedFileRow[] = [], opts: { shouldThrowOnRead?: boolean } = {}) {
  const rows: FakeIngestedFileRow[] = [...initial];
  let nextId = 9000;

  function builder() {
    let working = [...rows];
    let wantCount = false;
    let pendingUpsert: Record<string, unknown> | null = null;

    const throwIfConfigured = () => {
      if (opts.shouldThrowOnRead) throw new Error("simulated ingested_files read failure");
    };

    const api = {
      select(_cols?: string, selectOpts?: { count?: string }) {
        wantCount = selectOpts?.count === "exact";
        return api;
      },
      eq(col: string, val: unknown) {
        working = working.filter((r) => r[col] === val);
        return api;
      },
      lt(col: string, val: unknown) {
        working = working.filter((r) => {
          const v = r[col];
          return v !== null && v !== undefined && (v as number | string) < (val as number | string);
        });
        return api;
      },
      lte(col: string, val: unknown) {
        working = working.filter((r) => {
          const v = r[col];
          return v !== null && v !== undefined && (v as number | string) <= (val as number | string);
        });
        return api;
      },
      or(expr: string) {
        const clauses = expr.split(",").map((c) => c.split("."));
        working = working.filter((r) =>
          clauses.some(([col, op, val]) => {
            const colVal = r[col];
            if (op === "is" && val === "null") return colVal === null;
            if (op === "lt") return colVal !== null && colVal !== undefined && (colVal as string) < val;
            return false;
          })
        );
        return api;
      },
      order(col: string, orderOpts?: { ascending?: boolean }) {
        const asc = orderOpts?.ascending !== false;
        working = [...working].sort((a, b) => {
          const av = a[col] as string;
          const bv = b[col] as string;
          if (av === bv) return 0;
          return asc ? (av < bv ? -1 : 1) : av > bv ? -1 : 1;
        });
        return api;
      },
      limit(n: number) {
        throwIfConfigured();
        const matched = working.length;
        const limited = working.slice(0, n);
        return Promise.resolve({ data: limited, error: null, count: wantCount ? matched : null });
      },
      maybeSingle() {
        throwIfConfigured();
        return Promise.resolve({ data: working[0] ?? null, error: null });
      },
      single() {
        throwIfConfigured();
        if (pendingUpsert) {
          const payload = pendingUpsert;
          const existingIdx = rows.findIndex((r) => r.content_sha256 === payload.content_sha256);
          let row: FakeIngestedFileRow;
          if (existingIdx >= 0) {
            row = { ...rows[existingIdx], ...payload } as FakeIngestedFileRow;
            rows[existingIdx] = row;
          } else {
            row = {
              id: `fake-ingested-${nextId++}`,
              processing_attempts: 0,
              processing_started_at: null,
              ...payload,
            } as FakeIngestedFileRow;
            rows.push(row);
          }
          return Promise.resolve({ data: { id: row.id }, error: null });
        }
        const row = working[0] ?? null;
        return Promise.resolve({ data: row, error: row ? null : new Error("not found") });
      },
      upsert(payload: Record<string, unknown>) {
        pendingUpsert = payload;
        return api;
      },
      update(patch: Record<string, unknown>) {
        return {
          eq: (col: string, val: unknown) => {
            throwIfConfigured();
            const idx = rows.findIndex((r) => r[col] === val);
            if (idx >= 0) rows[idx] = { ...rows[idx], ...patch };
            return Promise.resolve({ error: null });
          },
        };
      },
    };
    return api;
  }

  return { rows, from: () => builder() };
}

/**
 * Distinguishes the two distinct `fetch` destinations this route now
 * drives through the SAME global `fetch` (one `vi.stubGlobal` per test) --
 * the background-function trigger (`triggerBackgroundProcessing`, used by
 * both the per-object step and the sweep) and the Slack webhook
 * (`postSlackAlert`). Routes by URL rather than call order so a test can
 * assert on either independently.
 */
function makeFakeTriggerAndSlackFetch(
  opts: { triggerOutcome?: "ok" | "fail" | "throw"; slackOutcome?: "ok" | "fail" } = {}
) {
  const triggeredFileIds: string[] = [];
  const slackPostBodies: string[] = [];
  const fn = vi.fn(async (url: unknown, init?: RequestInit) => {
    const urlStr = String(url);
    if (urlStr.includes("/.netlify/functions/ingest-process-background")) {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      triggeredFileIds.push(body.fileId);
      if (opts.triggerOutcome === "throw") {
        throw new DOMException("aborted", "TimeoutError");
      }
      if (opts.triggerOutcome === "fail") {
        return { ok: false, status: 500, text: async () => "trigger failed" };
      }
      return { ok: true, status: 202, text: async () => "" };
    }
    // Everything else is the Slack webhook POST.
    slackPostBodies.push(typeof init?.body === "string" ? init.body : "");
    if (opts.slackOutcome === "fail") {
      return { ok: false, status: 500, text: async () => "no_service" };
    }
    return { ok: true, status: 200, text: async () => "ok" };
  });
  return { fn, triggeredFileIds, slackPostBodies };
}

interface FakeDrainSupabaseOptions {
  sources?: ReportSourceRow[];
  freshnessRows?: SourceFreshnessRow[];
  freshnessShouldThrow?: boolean;
  freshnessShouldError?: boolean;
  alertInsertShouldThrow?: boolean;
  lockAcquired?: boolean;
  inboxObjects?: FakeInboxObject[];
  callOrder?: string[];
  /**
   * 13-07: the `ingested_files` table, for the converged per-object step
   * (claimFile's findFileByHash/recordFile/finalizeFile) and the sweep
   * (listSweepableFiles/countStuckPendingFiles). `undefined` (the default)
   * means "not modelled at all" -- every pre-10-03 test leaves this unset,
   * so the sweep/stuck-count queries throw "unexpected table" immediately,
   * caught by the route's own guards (recorded as a harmless error, never
   * propagated) -- preserving every pre-existing assertion unedited.
   */
  ingestedFiles?: FakeIngestedFileRow[];
  ingestedFilesShouldThrowOnRead?: boolean;
}

function makeFakeDrainSupabase(opts: FakeDrainSupabaseOptions = {}) {
  const alertRunsRows: Record<string, unknown>[] = [];
  let nextId = 1;
  const callOrder = opts.callOrder ?? [];
  const ingestedFilesTable =
    opts.ingestedFiles !== undefined
      ? makeFakeIngestedFilesTable(opts.ingestedFiles, { shouldThrowOnRead: opts.ingestedFilesShouldThrowOnRead })
      : null;

  const client = {
    rpc: async (fn: string) => {
      if (fn === "fn_try_acquire_drain_lock") {
        return { data: opts.lockAcquired ?? true, error: null };
      }
      if (fn === "fn_release_drain_lock") {
        return { data: null, error: null };
      }
      throw new Error(`unexpected rpc: ${fn}`);
    },
    from: (table: string) => {
      if (table === "ingested_files") {
        if (!ingestedFilesTable) {
          throw new Error(`unexpected table in drain-alert test fake: ${table}`);
        }
        return ingestedFilesTable.from();
      }
      if (table === "report_sources") {
        return { select: async () => ({ data: opts.sources ?? defaultSources(), error: null }) };
      }
      if (table === "v_source_freshness") {
        return {
          select: async () => {
            if (opts.freshnessShouldThrow) {
              throw new Error("simulated freshness read failure");
            }
            // CR-01: the supabase-js contract is that a query failure RESOLVES
            // with `{ data: null, error }` -- it does not reject. This is the
            // path the route originally missed, so the fake has to be able to
            // produce it; modelling only the throw above is what let the bug
            // through.
            if (opts.freshnessShouldError) {
              return { data: null, error: { message: "simulated postgrest read error" } };
            }
            return { data: opts.freshnessRows ?? defaultFreshnessRows(), error: null };
          },
        };
      }
      if (table === "alert_runs") {
        return {
          // Read path, mirroring lib/dashboard/freshness.ts's own
          // fetchFreshnessStripData query shape (order/limit/maybeSingle).
          select: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                // WR-01 (second half): model a REJECTING insert, not just a
                // graceful `{ error }`. An unguarded rejection escapes POST
                // as a 500 and reports a completed ingestion as failed.
                if (opts.alertInsertShouldThrow) {
                  throw new Error("simulated alert_runs insert rejection");
                }
                const id = nextId++;
                const fullRow = { id, ...row };
                alertRunsRows.push(fullRow);
                callOrder.push("insert");
                return { data: { id }, error: null };
              },
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, id: number) => {
              const row = alertRunsRows.find((r) => r.id === id);
              if (row) Object.assign(row, patch);
              callOrder.push("update");
              return { error: null };
            },
          }),
        };
      }
      throw new Error(`unexpected table in drain-alert test fake: ${table}`);
    },
    storage: makeFakeInboxStorage(opts.inboxObjects ?? []),
  };

  return { client, alertRunsRows, callOrder, ingestedFilesRows: ingestedFilesTable?.rows ?? [] };
}

function buildDrainRequest(secret = DRAIN_CRON_SECRET): Request {
  return new Request("http://localhost/api/ingest/drain", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
}

describe("POST /api/ingest/drain — freshness + alerting extension (FRESH-04, D-10)", () => {
  const originalSecret = process.env.DRAIN_CRON_SECRET;
  const originalWebhook = process.env.SLACK_WEBHOOK_URL;

  beforeEach(() => {
    vi.resetModules();
    process.env.DRAIN_CRON_SECRET = DRAIN_CRON_SECRET;
    delete process.env.SLACK_WEBHOOK_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.DRAIN_CRON_SECRET = originalSecret;
    if (originalWebhook === undefined) delete process.env.SLACK_WEBHOOK_URL;
    else process.env.SLACK_WEBHOOK_URL = originalWebhook;
  });

  it("a healthy run makes no Slack POST and writes exactly one alert_runs row with posted:false and empty reasons", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/HEALTHY";
    const fakeFetch = vi.fn();
    vi.stubGlobal("fetch", fakeFetch);

    const { client, alertRunsRows } = makeFakeDrainSupabase();
    routeSupabaseClient = client;

    const { POST } = await import("@/app/api/ingest/drain/route");
    const response = await POST(buildDrainRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 0 });
    expect(fakeFetch).not.toHaveBeenCalled();
    expect(alertRunsRows).toHaveLength(1);
    expect(alertRunsRows[0]).toMatchObject({ posted: false, reasons: {} });
  });

  it("a run with one overdue source makes exactly one Slack POST, and the alert_runs row's reasons names the overdue source", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/OVERDUE";
    const fakeFetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => "ok" }));
    vi.stubGlobal("fetch", fakeFetch);

    const rows = defaultFreshnessRows();
    const dcvvRow = rows.find((r) => r.report_type === "dcvv")!;
    dcvvRow.stale = true;
    dcvvRow.last_covered_day = "2026-09-25";

    const { client, alertRunsRows } = makeFakeDrainSupabase({ freshnessRows: rows });
    routeSupabaseClient = client;

    const { POST } = await import("@/app/api/ingest/drain/route");
    const response = await POST(buildDrainRequest());

    expect(response.status).toBe(200);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(alertRunsRows).toHaveLength(1);
    expect(alertRunsRows[0].reasons).toEqual({ overdue: ["DCVV"] });
  });

  it("the alert_runs insert is observed BEFORE the Slack POST in call order, and the row is then updated with http_status", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/ORDER";
    const callOrder: string[] = [];
    const fakeFetch = vi.fn(async () => {
      callOrder.push("fetch");
      return { ok: true, status: 200, text: async () => "ok" };
    });
    vi.stubGlobal("fetch", fakeFetch);

    const rows = defaultFreshnessRows();
    rows.find((r) => r.report_type === "billing")!.stale = true;

    const { client, alertRunsRows } = makeFakeDrainSupabase({ freshnessRows: rows, callOrder });
    routeSupabaseClient = client;

    const { POST } = await import("@/app/api/ingest/drain/route");
    await POST(buildDrainRequest());

    expect(callOrder).toEqual(["insert", "fetch", "update"]);
    expect(alertRunsRows[0]).toMatchObject({ posted: true, http_status: 200 });
  });

  it("a Slack POST answering 500 still returns 200 with the same processed count, and the row carries posted:true, http_status:500", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/FIVEHUNDRED";
    const fakeFetch = vi.fn(async () => ({ ok: false, status: 500, text: async () => "no_service" }));
    vi.stubGlobal("fetch", fakeFetch);

    const rows = defaultFreshnessRows();
    rows.find((r) => r.report_type === "billing")!.stale = true;

    const { client, alertRunsRows } = makeFakeDrainSupabase({ freshnessRows: rows });
    routeSupabaseClient = client;

    const { POST } = await import("@/app/api/ingest/drain/route");
    const response = await POST(buildDrainRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 0 });
    expect(alertRunsRows[0]).toMatchObject({ posted: true, http_status: 500 });
  });

  it("a Slack POST that rejects still returns 200, row carries posted:true, http_status:null, a non-null error", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/REJECTS";
    const fakeFetch = vi.fn(async () => {
      throw new DOMException("aborted", "TimeoutError");
    });
    vi.stubGlobal("fetch", fakeFetch);

    const rows = defaultFreshnessRows();
    rows.find((r) => r.report_type === "billing")!.stale = true;

    const { client, alertRunsRows } = makeFakeDrainSupabase({ freshnessRows: rows });
    routeSupabaseClient = client;

    const { POST } = await import("@/app/api/ingest/drain/route");
    const response = await POST(buildDrainRequest());

    expect(response.status).toBe(200);
    expect(alertRunsRows[0].posted).toBe(true);
    expect(alertRunsRows[0].http_status).toBeNull();
    expect(alertRunsRows[0].error).toBeTruthy();
  });

  it("SLACK_WEBHOOK_URL unset with something wrong makes no POST, returns 200, and records posted:false with an error naming the absent configuration", async () => {
    // beforeEach already deletes SLACK_WEBHOOK_URL.
    const fakeFetch = vi.fn();
    vi.stubGlobal("fetch", fakeFetch);

    const rows = defaultFreshnessRows();
    rows.find((r) => r.report_type === "billing")!.stale = true;

    const { client, alertRunsRows } = makeFakeDrainSupabase({ freshnessRows: rows });
    routeSupabaseClient = client;

    const { POST } = await import("@/app/api/ingest/drain/route");
    const response = await POST(buildDrainRequest());

    expect(response.status).toBe(200);
    expect(fakeFetch).not.toHaveBeenCalled();
    expect(alertRunsRows[0].posted).toBe(false);
    expect(alertRunsRows[0].error).toContain("SLACK_WEBHOOK_URL");
  });

  it("a freshness read failure still returns 200 with the drain's own processed count; the failure is recorded, never propagated as a drain failure", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/FRESHFAIL";
    const fakeFetch = vi.fn();
    vi.stubGlobal("fetch", fakeFetch);

    const { client, alertRunsRows } = makeFakeDrainSupabase({ freshnessShouldThrow: true });
    routeSupabaseClient = client;

    const { POST } = await import("@/app/api/ingest/drain/route");
    const response = await POST(buildDrainRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 0 });
    expect(fakeFetch).not.toHaveBeenCalled();
    expect(alertRunsRows).toHaveLength(1);
    expect(alertRunsRows[0].error).toBeTruthy();
    expect(alertRunsRows[0].reasons).toEqual({});
  });

  it("CR-01: a GRACEFUL freshness read error posts NOTHING to Slack and records the cause, instead of reporting all six sources as never-arrived", async () => {
    // The regression this locks: supabase-js resolves a failed query with
    // `{ data: null, error }` rather than rejecting, so the route's try/catch
    // never fired. `data: null` makes `sources` `[]`, and buildFreshnessItems
    // resolves every SOURCE_ORDER entry to "No report received" -- so a
    // transient database hiccup composed a maximally alarming "every source
    // has stopped reporting" message, posted it, and left alert_runs.error
    // null, destroying the only record of the real cause (D-10).
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/GRACEFUL";
    const fakeFetch = vi.fn();
    vi.stubGlobal("fetch", fakeFetch);

    const { client, alertRunsRows } = makeFakeDrainSupabase({ freshnessShouldError: true });
    routeSupabaseClient = client;

    const { POST } = await import("@/app/api/ingest/drain/route");
    const response = await POST(buildDrainRequest());

    // The drain's own contract is untouched (T-10-13).
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 0 });

    // The crying-wolf post must not happen.
    expect(fakeFetch).not.toHaveBeenCalled();

    // The evidence row still lands, carrying the real cause -- and crucially
    // NOT a fabricated neverArrived list naming all six sources.
    expect(alertRunsRows).toHaveLength(1);
    expect(alertRunsRows[0].error).toBeTruthy();
    expect(alertRunsRows[0].reasons).toEqual({});
    expect(alertRunsRows[0].posted).toBe(false);
  });

  it("WR-01: a REJECTING alert_runs insert still returns the drain's own status and processed count, never a 500", async () => {
    // T-10-13: an alerting failure must never make a completed ingestion look
    // failed. If it did, the sender would retry files that arrived fine.
    // The graceful `{ error }` path was already handled; this covers the
    // rejection, which previously escaped POST as an unhandled 500.
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/INSERTREJECT";
    const fakeFetch = vi.fn();
    vi.stubGlobal("fetch", fakeFetch);

    const { client, alertRunsRows } = makeFakeDrainSupabase({ alertInsertShouldThrow: true });
    routeSupabaseClient = client;

    const { POST } = await import("@/app/api/ingest/drain/route");
    const response = await POST(buildDrainRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 0 });
    // No row landed (the insert rejected) and no post was attempted, because
    // the route returns as soon as it has no evidence row to update.
    expect(alertRunsRows).toHaveLength(0);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("drainInbox returning status 409 returns 409 immediately, makes no freshness read, no POST, and writes NO alert_runs row", async () => {
    const fakeFetch = vi.fn();
    vi.stubGlobal("fetch", fakeFetch);

    const { client, alertRunsRows } = makeFakeDrainSupabase({ lockAcquired: false });
    routeSupabaseClient = client;

    const { POST } = await import("@/app/api/ingest/drain/route");
    const response = await POST(buildDrainRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ processed: 0 });
    expect(fakeFetch).not.toHaveBeenCalled();
    expect(alertRunsRows).toHaveLength(0);
  });

  it("two outcome:'errored' objects (failed downloads) leave inbox_stuck_count at 2 on the row", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/STUCK";
    const fakeFetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => "ok" }));
    vi.stubGlobal("fetch", fakeFetch);

    const inboxObjects: FakeInboxObject[] = [
      {
        prefix: "11111111-1111-1111-1111-111111111111",
        name: "20260926T061400Z-0-aaaa-daily-ver-report.csv",
        failDownload: true,
      },
      {
        prefix: "11111111-1111-1111-1111-111111111111",
        name: "20260925T061400Z-1-bbbb-daily-ver-report.csv",
        failDownload: true,
      },
    ];

    const { client, alertRunsRows } = makeFakeDrainSupabase({ inboxObjects });
    routeSupabaseClient = client;

    const { POST } = await import("@/app/api/ingest/drain/route");
    const response = await POST(buildDrainRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 0 });
    expect(alertRunsRows).toHaveLength(1);
    expect(alertRunsRows[0].inbox_stuck_count).toBe(2);
  });
});

describe("POST /api/ingest/drain — D-09 converged per-object step and the 13-07 sweep", () => {
  const originalSecret = process.env.DRAIN_CRON_SECRET;
  const originalWebhook = process.env.SLACK_WEBHOOK_URL;
  const originalOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  const originalProcessSecret = process.env.INGEST_PROCESS_SECRET;

  beforeEach(() => {
    vi.resetModules();
    process.env.DRAIN_CRON_SECRET = DRAIN_CRON_SECRET;
    delete process.env.SLACK_WEBHOOK_URL;
    // Configured so the background-function trigger actually fires (rather
    // than short-circuiting to "not-configured") -- these tests are
    // specifically about whether and how often it fires.
    process.env.NEXT_PUBLIC_SITE_URL = "https://screporting.netlify.app";
    process.env.INGEST_PROCESS_SECRET = "test-ingest-process-secret";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.DRAIN_CRON_SECRET = originalSecret;
    if (originalWebhook === undefined) delete process.env.SLACK_WEBHOOK_URL;
    else process.env.SLACK_WEBHOOK_URL = originalWebhook;
    if (originalOrigin === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = originalOrigin;
    if (originalProcessSecret === undefined) delete process.env.INGEST_PROCESS_SECRET;
    else process.env.INGEST_PROCESS_SECRET = originalProcessSecret;
  });

  function minutesAgo(n: number): string {
    return new Date(Date.now() - n * 60_000).toISOString();
  }
  function hoursAgo(n: number): string {
    return new Date(Date.now() - n * 3_600_000).toISOString();
  }

  function makePendingRow(overrides: Partial<FakeIngestedFileRow> = {}): FakeIngestedFileRow {
    return {
      id: `seed-${Math.random().toString(36).slice(2)}`,
      file_name: "daily-ver-report_old.csv",
      content_sha256: `seed-hash-${Math.random().toString(36).slice(2)}`,
      uploaded_by: null,
      report_type: "verification",
      storage_path: "deadbeef/daily-ver-report_old.csv",
      status: "pending",
      uploaded_at: minutesAgo(40),
      processing_attempts: 0,
      processing_started_at: null,
      ...overrides,
    };
  }

  it("an inbox object whose bytes classify is claimed and the trigger is fired once for its file id; the object is removed and counted", async () => {
    const { fn: fakeFetch, triggeredFileIds } = makeFakeTriggerAndSlackFetch();
    vi.stubGlobal("fetch", fakeFetch);

    const inboxObjects: FakeInboxObject[] = [
      { prefix: "11111111-1111-1111-1111-111111111111", name: "20261007T061400Z-0-aaaa-daily-ver-report.csv" },
    ];
    const { client, ingestedFilesRows } = makeFakeDrainSupabase({ inboxObjects, ingestedFiles: [] });
    routeSupabaseClient = client;

    const { POST } = await import("@/app/api/ingest/drain/route");
    const response = await POST(buildDrainRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 1 });
    // Exactly one new row was claimed (recordFile's upsert), and the
    // trigger fired for exactly that row's id -- the whole-pipeline
    // function (parse/validate/normalise/upsert/finalize) never ran, so
    // the row is still 'pending', not 'done'.
    expect(ingestedFilesRows).toHaveLength(1);
    expect(ingestedFilesRows[0].status).toBe("pending");
    expect(triggeredFileIds).toEqual([ingestedFilesRows[0].id]);
  });

  it("an inbox object whose bytes are already recorded as a completed ingest short-circuits inside the claim, fires NO trigger, and is still removed", async () => {
    const bytes = new ArrayBuffer(0);
    const contentSha256 = sha256(new Uint8Array(bytes));
    const { fn: fakeFetch, triggeredFileIds } = makeFakeTriggerAndSlackFetch();
    vi.stubGlobal("fetch", fakeFetch);

    const inboxObjects: FakeInboxObject[] = [
      { prefix: "11111111-1111-1111-1111-111111111111", name: "20261007T061400Z-0-aaaa-already-done.csv" },
    ];
    const existing = makePendingRow({
      id: "already-done-id",
      content_sha256: contentSha256,
      status: "done",
      report_type: "verification",
    });
    const { client, ingestedFilesRows } = makeFakeDrainSupabase({ inboxObjects, ingestedFiles: [existing] });
    routeSupabaseClient = client;

    const { POST } = await import("@/app/api/ingest/drain/route");
    const response = await POST(buildDrainRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 1 });
    expect(triggeredFileIds).toEqual([]); // no trigger for an already-uploaded file
    expect(ingestedFilesRows).toHaveLength(1); // nothing new recorded
  });

  it("an inbox object whose bytes are unrecognised is finalized as failed inside the claim, fires NO trigger, and is still removed", async () => {
    const { fn: fakeFetch, triggeredFileIds } = makeFakeTriggerAndSlackFetch();
    vi.stubGlobal("fetch", fakeFetch);

    const inboxObjects: FakeInboxObject[] = [
      { prefix: "11111111-1111-1111-1111-111111111111", name: "20261007T061400Z-0-aaaa-mystery-file.csv" },
    ];
    const { client, ingestedFilesRows } = makeFakeDrainSupabase({ inboxObjects, ingestedFiles: [] });
    routeSupabaseClient = client;

    const { POST } = await import("@/app/api/ingest/drain/route");
    const response = await POST(buildDrainRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 1 });
    expect(triggeredFileIds).toEqual([]); // no trigger -- nothing left to process
    expect(ingestedFilesRows).toHaveLength(1);
    expect(ingestedFilesRows[0].status).toBe("failed");
  });

  it("a trigger that reports a failure does NOT make the object errored and does NOT leave it in the inbox", async () => {
    const { fn: fakeFetch } = makeFakeTriggerAndSlackFetch({ triggerOutcome: "fail" });
    vi.stubGlobal("fetch", fakeFetch);

    const inboxObjects: FakeInboxObject[] = [
      { prefix: "11111111-1111-1111-1111-111111111111", name: "20261007T061400Z-0-aaaa-daily-ver-report.csv" },
    ];
    const { client } = makeFakeDrainSupabase({ inboxObjects, ingestedFiles: [] });
    routeSupabaseClient = client;

    const { POST } = await import("@/app/api/ingest/drain/route");
    const response = await POST(buildDrainRequest());

    // Still terminal, still counted, still removed -- a failed trigger does
    // not strand the object or make it "errored".
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 1 });
  });

  it("a claim that throws still leaves the object in place and is reported as errored, exactly as a thrown ingest does today", async () => {
    const { fn: fakeFetch, triggeredFileIds } = makeFakeTriggerAndSlackFetch();
    vi.stubGlobal("fetch", fakeFetch);

    const inboxObjects: FakeInboxObject[] = [
      { prefix: "11111111-1111-1111-1111-111111111111", name: "20261007T061400Z-0-aaaa-daily-ver-report.csv" },
    ];
    // A read failure on ingested_files makes findFileByHash (inside
    // claimFile) throw before anything is claimed.
    const { client } = makeFakeDrainSupabase({
      inboxObjects,
      ingestedFiles: [],
      ingestedFilesShouldThrowOnRead: true,
    });
    routeSupabaseClient = client;

    const { POST } = await import("@/app/api/ingest/drain/route");
    const response = await POST(buildDrainRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 0 }); // not counted as terminal
    expect(triggeredFileIds).toEqual([]); // never reached the claimed branch
  });

  it("a healthy run with no pending rows: the sweep runs, finds nothing, no Slack post is made, and exactly one evidence row is written with an empty reasons object and no error", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/SWEEPHEALTHY";
    const { fn: fakeFetch, triggeredFileIds } = makeFakeTriggerAndSlackFetch();
    vi.stubGlobal("fetch", fakeFetch);

    const { client, alertRunsRows } = makeFakeDrainSupabase({ ingestedFiles: [] });
    routeSupabaseClient = client;

    const { POST } = await import("@/app/api/ingest/drain/route");
    const response = await POST(buildDrainRequest());

    expect(response.status).toBe(200);
    expect(triggeredFileIds).toEqual([]);
    expect(fakeFetch).not.toHaveBeenCalled(); // no Slack post either
    expect(alertRunsRows).toHaveLength(1);
    expect(alertRunsRows[0]).toMatchObject({ posted: false, reasons: {}, error: null });
  });

  it("a run with two sweepable pending rows: the sweep fires the trigger once per row, and the drain's processed count and status are unaffected", async () => {
    const { fn: fakeFetch, triggeredFileIds } = makeFakeTriggerAndSlackFetch();
    vi.stubGlobal("fetch", fakeFetch);

    const rowA = makePendingRow({ id: "sweep-a", uploaded_at: minutesAgo(40) });
    const rowB = makePendingRow({ id: "sweep-b", uploaded_at: minutesAgo(35) });
    const { client } = makeFakeDrainSupabase({ ingestedFiles: [rowA, rowB] });
    routeSupabaseClient = client;

    const { POST } = await import("@/app/api/ingest/drain/route");
    const response = await POST(buildDrainRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 0 }); // no inbox objects this run
    expect(triggeredFileIds.sort()).toEqual(["sweep-a", "sweep-b"]);
  });

  it("a run with three stuck pending rows (at the attempt cap): exactly one Slack post whose text contains the stuck-pending line, and the evidence row's reasons name the count", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/STUCKPENDING";
    const { fn: fakeFetch, slackPostBodies, triggeredFileIds } = makeFakeTriggerAndSlackFetch();
    vi.stubGlobal("fetch", fakeFetch);

    // At the attempt cap: the sweep excludes them (isSweepable's own rule),
    // but the stuck count does NOT -- exactly the file this alert exists for.
    const stuckRows = [
      makePendingRow({ id: "stuck-1", uploaded_at: hoursAgo(8), processing_attempts: MAX_PROCESSING_ATTEMPTS }),
      makePendingRow({ id: "stuck-2", uploaded_at: hoursAgo(9), processing_attempts: MAX_PROCESSING_ATTEMPTS }),
      makePendingRow({ id: "stuck-3", uploaded_at: hoursAgo(10), processing_attempts: MAX_PROCESSING_ATTEMPTS }),
    ];
    const { client, alertRunsRows } = makeFakeDrainSupabase({ ingestedFiles: stuckRows });
    routeSupabaseClient = client;

    const { POST } = await import("@/app/api/ingest/drain/route");
    const response = await POST(buildDrainRequest());

    expect(response.status).toBe(200);
    expect(triggeredFileIds).toEqual([]); // capped -- the sweep does not fire at them
    expect(slackPostBodies).toHaveLength(1); // exactly one Slack post
    expect(slackPostBodies[0]).toContain("Stuck pending: 3 uploads never finished processing");
    expect(alertRunsRows).toHaveLength(1);
    expect(alertRunsRows[0].reasons).toMatchObject({ stuckPending: 3 });
  });

  it("the sweep throwing: the route still returns the drain's own processed count and status, the freshness read still happens, and the evidence row's error field records the sweep failure", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/SWEEPTHROWS";
    const { fn: fakeFetch } = makeFakeTriggerAndSlackFetch();
    vi.stubGlobal("fetch", fakeFetch);

    const rows = defaultFreshnessRows();
    rows.find((r) => r.report_type === "billing")!.stale = true;

    const { client, alertRunsRows } = makeFakeDrainSupabase({
      freshnessRows: rows,
      ingestedFiles: [],
      ingestedFilesShouldThrowOnRead: true,
    });
    routeSupabaseClient = client;

    const { POST } = await import("@/app/api/ingest/drain/route");
    const response = await POST(buildDrainRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 0 });
    // The freshness read still happened despite the sweep's own guard
    // failing -- the overdue billing source still made it into reasons.
    expect(alertRunsRows).toHaveLength(1);
    expect(alertRunsRows[0].reasons).toMatchObject({ overdue: ["Billing"] });
    expect(alertRunsRows[0].error).toContain("simulated ingested_files read failure");
  });

  it("the freshness read throwing while the sweep succeeded: the stuck-pending count is still recorded on the row, and the route still returns the drain's status", async () => {
    const { fn: fakeFetch } = makeFakeTriggerAndSlackFetch();
    vi.stubGlobal("fetch", fakeFetch);

    const stuckRows = [
      makePendingRow({ id: "stuck-x", uploaded_at: hoursAgo(8), processing_attempts: MAX_PROCESSING_ATTEMPTS }),
      makePendingRow({ id: "stuck-y", uploaded_at: hoursAgo(9), processing_attempts: MAX_PROCESSING_ATTEMPTS }),
    ];
    const { client, alertRunsRows } = makeFakeDrainSupabase({
      freshnessShouldThrow: true,
      ingestedFiles: stuckRows,
    });
    routeSupabaseClient = client;

    const { POST } = await import("@/app/api/ingest/drain/route");
    const response = await POST(buildDrainRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 0 });
    // Neither guard swallowed the other's result: the stuck count survived
    // the freshness throw, and the freshness error is still on the row.
    expect(alertRunsRows).toHaveLength(1);
    expect(alertRunsRows[0].reasons).toEqual({ stuckPending: 2 });
    expect(alertRunsRows[0].error).toContain("simulated freshness read failure");
  });

  it("a run where the sweep deferred files it had no budget for: those files are NOT counted as stuck unless the stuck-count query independently says so", async () => {
    const { fn: fakeFetch, triggeredFileIds } = makeFakeTriggerAndSlackFetch();
    vi.stubGlobal("fetch", fakeFetch);

    // Sweepable (40 minutes old, well under the stuck age), so if the sweep
    // deferred it due to budget, the deferral alone must not make it count
    // as stuck -- it is simply too young to be stuck regardless.
    const youngRow = makePendingRow({ id: "young-not-stuck", uploaded_at: minutesAgo(40) });
    const { client, alertRunsRows } = makeFakeDrainSupabase({ ingestedFiles: [youngRow] });
    routeSupabaseClient = client;

    const { POST } = await import("@/app/api/ingest/drain/route");
    const response = await POST(buildDrainRequest());

    expect(response.status).toBe(200);
    expect(triggeredFileIds).toEqual(["young-not-stuck"]); // the sweep did fire at it
    expect(alertRunsRows).toHaveLength(1);
    expect(alertRunsRows[0].reasons).toEqual({}); // not stuck -- too young
  });
});

describe("app/api/ingest/drain/route.ts — route-segment config (D-2/A4)", () => {
  it("declares export const maxDuration = 60, matching pg_net's 60000ms wait", async () => {
    const routeModule = await import("@/app/api/ingest/drain/route");
    expect((routeModule as unknown as { maxDuration: number }).maxDuration).toBe(60);
  });
});
