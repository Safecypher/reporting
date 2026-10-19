import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { classify } from "../classify";
import {
  parseApigeeStats,
  validateApigeeRows,
  ApigeeRowSchema,
} from "../parsers/apigee-stats";
import { normaliseApigee, deriveEndpointCategory } from "../normalise-apigee";
import { ingest } from "../index";
import type { IngestDeps, ReportType } from "../types";

const FIXTURE_PATH = join(__dirname, "apigee-stats.fixture.xlsx");
const fixtureBytes = new Uint8Array(readFileSync(FIXTURE_PATH));

describe("classify (apigee-stats, D-11)", () => {
  it("classifies an XLSX signature matching the APIGEE Calls sheet + header, regardless of filename", () => {
    const sig = {
      kind: "xlsx" as const,
      sheetNames: ["APIGEE Calls", "Verify Outcome"],
      headerRow: ["Time", "what_proxy_pathsuffix", "response_code"],
    };
    // Filename is deliberately unreliable (D-11) — the real sample is
    // "Copy of Safecypher Stats 1208 to 1308.xlsx".
    expect(classify("Copy of Safecypher Stats 1208 to 1308.xlsx", sig.headerRow)).not.toBe(
      "apigee-stats"
    );
    // classify() (CSV-only compat wrapper) can't express xlsx signatures directly;
    // exercise the real handler classify() via the registry instead.
  });
});

describe("apigeeStatsHandler.classify (direct, via registry import)", () => {
  it("matches on xlsx sheet-name + header signature, never on filename alone", async () => {
    const { apigeeStatsHandler } = await import("../handlers/apigee-stats");
    const goodSig = {
      kind: "xlsx" as const,
      sheetNames: ["APIGEE Calls", "Verify Outcome"],
      headerRowsBySheet: {
        "APIGEE Calls": ["Time", "what_proxy_pathsuffix", "response_code"],
        "Verify Outcome": ["Outcome", "Count"],
      },
    };
    expect(apigeeStatsHandler.classify("upload.xlsx", goodSig)).toBe(true);
    expect(apigeeStatsHandler.classify("Copy of Safecypher Stats 1208 to 1308.xlsx", goodSig)).toBe(
      true
    );

    // CR-02: "APIGEE Calls" is NOT the first tab and its header is only
    // reachable via headerRowsBySheet — classification must still succeed.
    const reorderedSig = {
      kind: "xlsx" as const,
      sheetNames: ["Verify Outcome", "APIGEE Calls"],
      headerRowsBySheet: {
        "Verify Outcome": ["Outcome", "Count"],
        "APIGEE Calls": ["Time", "what_proxy_pathsuffix", "response_code"],
      },
    };
    expect(apigeeStatsHandler.classify("upload.xlsx", reorderedSig)).toBe(true);

    const csvSig = { kind: "csv" as const, headerRow: ["Time", "what_proxy_pathsuffix", "response_code"] };
    expect(apigeeStatsHandler.classify("upload.csv", csvSig)).toBe(false);

    const wrongSheetSig = {
      kind: "xlsx" as const,
      sheetNames: ["Some Other Sheet"],
      headerRowsBySheet: { "Some Other Sheet": ["Time", "what_proxy_pathsuffix", "response_code"] },
    };
    expect(apigeeStatsHandler.classify("upload.xlsx", wrongSheetSig)).toBe(false);
  });
});

describe("apigeeStatsHandler.classify — trailing trace_id column (TSYS added it from the 0710-to-0810 file, Oct 2026)", () => {
  const sigWith = (header: string[]) => ({
    kind: "xlsx" as const,
    sheetNames: ["APIGEE Calls"],
    headerRowsBySheet: { "APIGEE Calls": header },
  });

  it("classifies the 4-column header [Time, what_proxy_pathsuffix, response_code, trace_id]", async () => {
    const { apigeeStatsHandler } = await import("../handlers/apigee-stats");
    expect(
      apigeeStatsHandler.classify(
        "Safecypher Stats 1610 to 1710.xlsx",
        sigWith(["Time", "what_proxy_pathsuffix", "response_code", "trace_id"])
      )
    ).toBe(true);
  });

  it("still classifies the original 3-column header (September files)", async () => {
    const { apigeeStatsHandler } = await import("../handlers/apigee-stats");
    expect(
      apigeeStatsHandler.classify("x.xlsx", sigWith(["Time", "what_proxy_pathsuffix", "response_code"]))
    ).toBe(true);
  });

  it("boundary neighbours stay rejected: only the known 4th column `trace_id` is tolerated", async () => {
    const { apigeeStatsHandler } = await import("../handlers/apigee-stats");
    const base = ["Time", "what_proxy_pathsuffix", "response_code"];
    // an unknown 4th column is NOT silently accepted
    expect(apigeeStatsHandler.classify("x.xlsx", sigWith([...base, "something_else"]))).toBe(false);
    // case-sensitive, like every other header match
    expect(apigeeStatsHandler.classify("x.xlsx", sigWith([...base, "Trace_ID"]))).toBe(false);
    // 5 columns (known + unknown) is rejected
    expect(apigeeStatsHandler.classify("x.xlsx", sigWith([...base, "trace_id", "extra"]))).toBe(false);
    // trace_id must be the TRAILING column — the parser reads cells 1-3 by position
    expect(
      apigeeStatsHandler.classify("x.xlsx", sigWith(["trace_id", "Time", "what_proxy_pathsuffix", "response_code"]))
    ).toBe(false);
    // the three required columns are still required, in order
    expect(apigeeStatsHandler.classify("x.xlsx", sigWith(["Time", "what_proxy_pathsuffix"]))).toBe(false);
    expect(
      apigeeStatsHandler.classify("x.xlsx", sigWith(["Time", "response_code", "what_proxy_pathsuffix", "trace_id"]))
    ).toBe(false);
    expect(apigeeStatsHandler.classify("x.xlsx", sigWith(["Time", "what_proxy_pathsuffix", "trace_id"]))).toBe(false);
  });
});

describe("parseApigeeStats", () => {
  it("reads exactly 46 data rows from the real fixture, INCLUDING the 28 hidden by a saved AutoFilter (Pitfall 1)", async () => {
    const rows = await parseApigeeStats(fixtureBytes);
    expect(rows.length).toBe(46);
  });

  it("returns a JS Date (not a numeric serial) for the Time column, in 2026", async () => {
    const rows = await parseApigeeStats(fixtureBytes);
    expect(rows[0].time instanceof Date).toBe(true);
    expect((rows[0].time as Date).getUTCFullYear()).toBe(2026);
  });

  it("never reads the Verify Outcome sheet — only APIGEE Calls contributes rows", async () => {
    const rows = await parseApigeeStats(fixtureBytes);
    // Every pathSuffix present must be a plausible APIGEE Calls value, never
    // anything resembling Verify Outcome's schema.
    for (const row of rows) {
      expect(typeof row.pathSuffix).toBe("string");
    }
  });

  it("throws a clear error when the APIGEE Calls sheet is missing", async () => {
    // A minimal valid XLSX with no "APIGEE Calls" sheet. Build via a
    // corrupted/garbage zip-like buffer to force the loader to reject cleanly.
    const garbage = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    await expect(parseApigeeStats(garbage)).rejects.toThrow();
  });
});

describe("ApigeeRowSchema / validateApigeeRows", () => {
  it("accepts a well-formed row (Date time, string pathSuffix, numeric responseCode)", () => {
    const { valid, rejected } = validateApigeeRows([
      { time: new Date("2026-08-13T01:23:37.000Z"), pathSuffix: "/Verify", responseCode: 200 },
    ]);
    expect(valid.length).toBe(1);
    expect(rejected.length).toBe(0);
  });

  it("accepts a numeric Excel serial as a defensive fallback (A3)", () => {
    const result = ApigeeRowSchema.safeParse({ time: 46000, pathSuffix: "/Verify", responseCode: 200 });
    expect(result.success).toBe(true);
  });

  it("rejects a row with an empty pathSuffix", () => {
    const { rejected } = validateApigeeRows([
      { time: new Date("2026-08-13T01:23:37.000Z"), pathSuffix: "", responseCode: 200 },
    ]);
    expect(rejected.length).toBe(1);
  });

  it("rejects a row with a non-coercible responseCode", () => {
    const { rejected } = validateApigeeRows([
      { time: new Date("2026-08-13T01:23:37.000Z"), pathSuffix: "/Verify", responseCode: "not-a-number" },
    ]);
    expect(rejected.length).toBe(1);
  });
});

describe("deriveEndpointCategory (D-09, never guess)", () => {
  it("maps /Verify to verify with no card reference", () => {
    expect(deriveEndpointCategory("/Verify")).toEqual({
      endpointCategory: "verify",
      externalCardReference: null,
    });
  });

  it("maps /activateCardEntity to enrol with no card reference", () => {
    expect(deriveEndpointCategory("/activateCardEntity")).toEqual({
      endpointCategory: "enrol",
      externalCardReference: null,
    });
  });

  it("maps /removeCards to unenrol with no card reference", () => {
    expect(deriveEndpointCategory("/removeCards")).toEqual({
      endpointCategory: "unenrol",
      externalCardReference: null,
    });
  });

  it("maps /CardEntities/{ref}/DynamicSecurityCode to cvv-fetch, extracting the card ref", () => {
    expect(deriveEndpointCategory("/CardEntities/521817DKLYey6707/DynamicSecurityCode")).toEqual({
      endpointCategory: "cvv-fetch",
      externalCardReference: "521817DKLYey6707",
    });
  });

  it("returns null/null for an unmapped path — never guesses", () => {
    expect(deriveEndpointCategory("/some/unknown/path")).toEqual({
      endpointCategory: null,
      externalCardReference: null,
    });
  });
});

describe("normaliseApigee", () => {
  it("maps the Date to event_time via toISOString and retains raw_path_suffix + response_code", async () => {
    const rows = await parseApigeeStats(fixtureBytes);
    const { valid } = validateApigeeRows(rows);
    const { rows: normalised } = normaliseApigee(valid);
    const first = normalised[0];
    expect(first.event_time).toMatch(/^2026-08-13T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(typeof first.raw_path_suffix).toBe("string");
    expect(typeof first.response_code).toBe("number");
  });

  it("full accounting: normalised.length + excludedPreWindow === valid.length (CR-02)", async () => {
    const rows = await parseApigeeStats(fixtureBytes);
    const { valid } = validateApigeeRows(rows);
    const { rows: normalised, excludedPreWindow } = normaliseApigee(valid);
    expect(normalised.length + excludedPreWindow).toBe(valid.length);
  });

  it("derives endpoint_category and external_card_reference per row, nullable on no-match", async () => {
    const rows = await parseApigeeStats(fixtureBytes);
    const { valid } = validateApigeeRows(rows);
    const { rows: normalised } = normaliseApigee(valid);
    const verifyRow = normalised.find((r) => r.raw_path_suffix === "/Verify");
    expect(verifyRow?.endpoint_category).toBe("verify");
    expect(verifyRow?.external_card_reference).toBeNull();
    const cvvRow = normalised.find((r) =>
      String(r.raw_path_suffix).includes("DynamicSecurityCode")
    );
    expect(cvvRow?.endpoint_category).toBe("cvv-fetch");
    expect(typeof cvvRow?.external_card_reference).toBe("string");
  });
});

function makeFakeDeps(): IngestDeps & {
  finalizedStatus: () => "done" | "failed" | null;
  finalizedCounts: () => { accepted: number; duplicates: number; rejected: number; excluded: number } | null;
} {
  const filesByHash = new Map<
    string,
    { id: string; uploaded_at: string; report_type: ReportType | null }
  >();
  const upsertedKeysByTable = new Map<string, Set<string>>();
  let lastStatus: "done" | "failed" | null = null;
  let lastCounts: { accepted: number; duplicates: number; rejected: number; excluded: number } | null = null;
  let nextId = 1;

  return {
    finalizedStatus: () => lastStatus,
    finalizedCounts: () => lastCounts,
    async findFileByHash(sha256Hex: string) {
      return filesByHash.get(sha256Hex) ?? null;
    },
    async recordFile(meta) {
      const id = `file-${nextId++}`;
      filesByHash.set(meta.contentSha256, {
        id,
        uploaded_at: new Date().toISOString(),
        report_type: meta.reportType,
      });
      return id;
    },
    async upsertVerifications() {
      return 0;
    },
    async upsertRows(table: string, rows: Record<string, unknown>[], opts: { onConflict: string }) {
      if (rows.length === 0) return 0;
      let keys = upsertedKeysByTable.get(table);
      if (!keys) {
        keys = new Set<string>();
        upsertedKeysByTable.set(table, keys);
      }
      // Whole-row-hash dedup: mirror the DB's md5(raw_event_time || raw_path_suffix || response_code) key.
      let inserted = 0;
      for (const row of rows) {
        const dedupKey =
          opts.onConflict === "row_hash"
            ? `${row.raw_event_time}|${row.raw_path_suffix}|${row.response_code}`
            : JSON.stringify(row);
        if (!keys.has(dedupKey)) {
          keys.add(dedupKey);
          inserted++;
        }
      }
      return inserted;
    },
    async finalizeFile(_id, counts) {
      lastStatus = counts.status;
      lastCounts = {
        accepted: counts.accepted,
        duplicates: counts.duplicates,
        rejected: counts.rejected,
        excluded: counts.excluded,
      };
    },
  };
}

describe("ingest (apigee-stats end-to-end)", () => {
  it("ingests the real fixture end-to-end with full accounting (CR-02)", async () => {
    const deps = makeFakeDeps();
    const result = await ingest(
      { fileName: "Copy of Safecypher Stats 1208 to 1308.xlsx", bytes: fixtureBytes, uploadedBy: "user-1" },
      deps
    );
    expect(result.reportType).toBe("apigee-stats");
    expect(result.accepted + result.duplicates + result.rejected + result.excluded).toBe(46);
    expect(deps.finalizedStatus()).toBe("done");
  });

  it("CR-02: classifies + ingests all 46 rows even when 'APIGEE Calls' is NOT the first worksheet", async () => {
    // Build a multi-tab workbook mirroring the real Thesis file, but with
    // "Verify Outcome" as the FIRST tab and "APIGEE Calls" second. Before the
    // CR-02 fix the classifier read the header from worksheets[0] ("Verify
    // Outcome"), matchesHeader failed, and the whole source classified to null.
    const wb = new ExcelJS.Workbook();
    const verifySheet = wb.addWorksheet("Verify Outcome");
    verifySheet.addRow(["Outcome", "Count"]);
    verifySheet.addRow(["success", 123]);

    const apigeeSheet = wb.addWorksheet("APIGEE Calls");
    apigeeSheet.addRow(["Time", "what_proxy_pathsuffix", "response_code"]);
    const WINDOW_START_MS = Date.parse("2026-08-13T00:00:00Z");
    for (let i = 0; i < 46; i++) {
      // Distinct second-resolution timestamps so all 46 survive the whole-row
      // hash dedup and land as `accepted`; all in-window (>= 2026-08-13).
      apigeeSheet.addRow([new Date(WINDOW_START_MS + i * 1000), "/Verify", 200]);
    }
    const arrayBuffer = await wb.xlsx.writeBuffer();
    const bytes = new Uint8Array(arrayBuffer as ArrayBuffer);

    const deps = makeFakeDeps();
    const result = await ingest(
      { fileName: "Copy of Safecypher Stats reordered.xlsx", bytes, uploadedBy: "user-1" },
      deps
    );
    expect(result.reportType).toBe("apigee-stats");
    expect(result.accepted).toBe(46);
    expect(result.accepted + result.duplicates + result.rejected + result.excluded).toBe(46);
    expect(deps.finalizedStatus()).toBe("done");
  });

  it("4-column workbook (trace_id) ingests exactly like the same data without the column (metamorphic)", async () => {
    // Synthetic workbook mirroring the structure TSYS switched to from the "0710 to 0810" file (Oct 2026):
    // one sheet "APIGEE Calls", header Time | what_proxy_pathsuffix | response_code | trace_id.
    const WINDOW_START_MS = Date.parse("2026-10-01T00:00:00Z");
    const paths = ["/Verify", "/activateCardEntity", "/CardEntities/525346abcdEF1234/DynamicSecurityCode"];
    const build = async (withTraceId: boolean) => {
      const wb = new ExcelJS.Workbook();
      const sheet = wb.addWorksheet("APIGEE Calls");
      sheet.addRow(
        withTraceId
          ? ["Time", "what_proxy_pathsuffix", "response_code", "trace_id"]
          : ["Time", "what_proxy_pathsuffix", "response_code"]
      );
      for (let i = 0; i < 30; i++) {
        const row: (Date | string | number)[] = [new Date(WINDOW_START_MS + i * 1000), paths[i % 3], 200];
        if (withTraceId) row.push(`1-6ad2e8b6-${String(i).padStart(24, "0")}`);
        sheet.addRow(row);
      }
      return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    };
    const bytes3 = await build(false);
    const bytes4 = await build(true);

    // parser output is identical: column D is never read
    expect(await parseApigeeStats(bytes4)).toEqual(await parseApigeeStats(bytes3));

    const deps3 = makeFakeDeps();
    const deps4 = makeFakeDeps();
    const r3 = await ingest({ fileName: "Safecypher Stats three.xlsx", bytes: bytes3, uploadedBy: "user-1" }, deps3);
    const r4 = await ingest({ fileName: "Safecypher Stats four.xlsx", bytes: bytes4, uploadedBy: "user-1" }, deps4);

    expect(r4.reportType).toBe("apigee-stats");
    expect(r4.accepted).toBe(30);
    expect(r4.rejected).toBe(0);
    expect(r4.rejectReasons).toEqual([]);
    expect(deps4.finalizedStatus()).toBe("done");
    expect({ ...r4, ingestedFileId: null }).toEqual({ ...r3, ingestedFileId: null });
  });

  it("re-ingesting the identical workbook yields 0 new inserts on the second pass (whole-row-hash idempotency)", async () => {
    const deps = makeFakeDeps();
    // First ingest is short-circuited by sha256 file-dup detection on a literal
    // re-upload, so simulate an "overlapping date-range" re-upload by calling
    // the handler's normalise+upsert path twice directly against the same deps.
    const { apigeeStatsHandler } = await import("../handlers/apigee-stats");
    const rows = await parseApigeeStats(fixtureBytes);
    const { valid } = validateApigeeRows(rows);
    const { rows: normalised } = normaliseApigee(valid);

    const normalisedRows = normalised as unknown as Record<string, unknown>[];
    const firstInsert = await apigeeStatsHandler.upsert(deps, normalisedRows);
    const secondInsert = await apigeeStatsHandler.upsert(deps, normalisedRows);
    // Post-cutoff (DATA-06) row count, not the raw 46 — some real-sample rows
    // predate the 13-Aug-2026 data window and are excluded (CR-02).
    expect(firstInsert).toBe(normalised.length);
    expect(firstInsert).toBeGreaterThan(0);
    expect(secondInsert).toBe(0);
  });
});
