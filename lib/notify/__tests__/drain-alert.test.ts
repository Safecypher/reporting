import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { hashToken } from "@/lib/push/tokens";
import type { ReportSourceRow, SourceFreshnessRow } from "@/lib/dashboard/freshness";

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
  return {
    removed,
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
    }),
  };
}

interface FakeDrainSupabaseOptions {
  sources?: ReportSourceRow[];
  freshnessRows?: SourceFreshnessRow[];
  freshnessShouldThrow?: boolean;
  lockAcquired?: boolean;
  inboxObjects?: FakeInboxObject[];
  callOrder?: string[];
}

function makeFakeDrainSupabase(opts: FakeDrainSupabaseOptions = {}) {
  const alertRunsRows: Record<string, unknown>[] = [];
  let nextId = 1;
  const callOrder = opts.callOrder ?? [];

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
      if (table === "report_sources") {
        return { select: async () => ({ data: opts.sources ?? defaultSources(), error: null }) };
      }
      if (table === "v_source_freshness") {
        return {
          select: async () => {
            if (opts.freshnessShouldThrow) {
              throw new Error("simulated freshness read failure");
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

  return { client, alertRunsRows, callOrder };
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

describe("app/api/ingest/drain/route.ts — route-segment config (D-2/A4)", () => {
  it("declares export const maxDuration = 60, matching pg_net's 60000ms wait", async () => {
    const routeModule = await import("@/app/api/ingest/drain/route");
    expect((routeModule as unknown as { maxDuration: number }).maxDuration).toBe(60);
  });
});
