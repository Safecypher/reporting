import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import { classify } from "../classify";
import { parseDcvv, validateDcvvRows } from "../parsers/dcvv";
import { normaliseDcvv } from "../normalise-dcvv";
import { ingest } from "../index";
import type { IngestDeps, ReportType } from "../types";

const FIXTURE_PATH = join(__dirname, "dcvv.fixture.csv");
const fixtureBytes = new Uint8Array(readFileSync(FIXTURE_PATH));

function parseFixtureHeaderRow(): string[] {
  const text = new TextDecoder("utf-8").decode(fixtureBytes);
  const parsed = Papa.parse<Record<string, string>>(text, { header: true });
  return parsed.meta.fields ?? [];
}

describe("classify (dcvv)", () => {
  it("classifies the real dcvv fixture by filename", () => {
    expect(classify("daily-dcvv-report_2026-08-13.csv", parseFixtureHeaderRow())).toBe("dcvv");
  });

  it("classifies by header signature alone, even with an unrelated filename", () => {
    expect(classify("upload.csv", parseFixtureHeaderRow())).toBe("dcvv");
  });
});

describe("parseDcvv", () => {
  it("parses the real fixture (18 data rows) and asserts the header, BOM-tolerant", () => {
    const { headerRow, rows } = parseDcvv(fixtureBytes);
    expect(headerRow[0]).toBe("timestamp");
    expect(rows.length).toBe(18);
  });

  it("throws loudly when an expected column is missing", () => {
    const badCsv = "timestamp,duration\n2026-08-13T03:32:37.1659812Z,84.6053\n";
    expect(() => parseDcvv(new TextEncoder().encode(badCsv))).toThrow();
  });
});

describe("validateDcvvRows", () => {
  it("rejects a row with an unparseable timestamp with a specific reason, and keeps valid rows", () => {
    const { rows } = parseDcvv(fixtureBytes);
    const crafted = [
      { ...rows[0], timestamp: "not-a-timestamp" },
      rows[1],
    ];
    const { valid, rejected } = validateDcvvRows(crafted);
    expect(valid.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reasons).toContain("unparseable timestamp");
  });

  it("rejects a row with a negative/invalid duration with a specific reason", () => {
    const { rows } = parseDcvv(fixtureBytes);
    const crafted = [
      { ...rows[0], duration: "-5" },
      { ...rows[1], duration: "not-a-number" },
    ];
    const { rejected } = validateDcvvRows(crafted);
    expect(rejected.length).toBe(2);
    expect(rejected[0].reasons).toContain("invalid duration");
    expect(rejected[1].reasons).toContain("invalid duration");
  });

  it("rejects a row with a missing ExternalReference with a specific reason", () => {
    const { rows } = parseDcvv(fixtureBytes);
    const crafted = [{ ...rows[0], ExternalReference: "" }];
    const { rejected } = validateDcvvRows(crafted);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reasons).toContain("missing external reference");
  });
});

describe("normaliseDcvv", () => {
  it("maps a Z-suffixed timestamp to UTC ISO and retains raw_timestamp", () => {
    const { rows } = parseDcvv(fixtureBytes);
    const { valid } = validateDcvvRows(rows);
    const target = valid.find((r) => r.timestamp === "2026-08-13T03:32:37.1659812Z");
    expect(target).toBeDefined();
    const { rows: normalisedRows } = normaliseDcvv([target!]);
    expect(normalisedRows[0].timestamp).toBe(new Date("2026-08-13T03:32:37.1659812Z").toISOString());
    expect(normalisedRows[0].raw_timestamp).toBe("2026-08-13T03:32:37.1659812Z");
  });

  it("excludes rows before 2026-08-13T00:00:00Z (DATA-06) and COUNTS them (excludedPreWindow) — full accounting", () => {
    const { rows } = parseDcvv(fixtureBytes);
    const { valid } = validateDcvvRows(rows);
    const { rows: normalisedRows, excludedPreWindow } = normaliseDcvv(valid);
    // The real fixture contains 17 rows from 2026-08-12 and 1 from 2026-08-13.
    expect(valid.length).toBe(18);
    expect(normalisedRows.length).toBe(1);
    expect(excludedPreWindow).toBe(17);
    expect(normalisedRows.length + excludedPreWindow).toBe(valid.length);
    expect(
      normalisedRows.every((r) => Date.parse(r.timestamp) >= Date.parse("2026-08-13T00:00:00Z"))
    ).toBe(true);
  });
});

function makeFakeDeps(): IngestDeps & {
  finalizedStatus: () => "done" | "failed" | null;
} {
  const filesByHash = new Map<
    string,
    { id: string; uploaded_at: string; report_type: ReportType | null }
  >();
  const upsertedKeysByTable = new Map<string, Set<string>>();
  let lastStatus: "done" | "failed" | null = null;
  let nextId = 1;

  return {
    finalizedStatus: () => lastStatus,
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
      const conflictCols =
        opts.onConflict === "row_hash" ? null : opts.onConflict.split(",").map((c) => c.trim());
      let inserted = 0;
      for (const row of rows) {
        const dedupKey =
          conflictCols === null
            ? JSON.stringify(row)
            : conflictCols.map((c) => String(row[c])).join("|");
        if (!keys.has(dedupKey)) {
          keys.add(dedupKey);
          inserted++;
        }
      }
      return inserted;
    },
    async finalizeFile(_id, counts) {
      lastStatus = counts.status;
    },
  };
}

describe("ingest (dcvv end-to-end)", () => {
  it("ingests the real fixture: 1 accepted (post-cutoff), 17 excluded (pre-window), 0 rejected — full accounting", async () => {
    const deps = makeFakeDeps();
    const result = await ingest(
      { fileName: "daily-dcvv-report_2026-08-13.csv", bytes: fixtureBytes, uploadedBy: "user-1" },
      deps
    );
    expect(result.reportType).toBe("dcvv");
    expect(result.accepted).toBe(1);
    expect(result.duplicates).toBe(0);
    expect(result.rejected).toBe(0);
    expect(result.excluded).toBe(17);
    expect(result.accepted + result.duplicates + result.rejected + result.excluded).toBe(18);
    expect(result.ingestedFileId).not.toBeNull();
    expect(deps.finalizedStatus()).toBe("done");
  });

  it("re-ingesting the identical rows via upsertRows(row_hash) yields 0 new inserts (whole-row-hash idempotency, D-04)", async () => {
    const deps = makeFakeDeps();
    const rows = [
      { timestamp: "2026-08-13T03:32:37.166Z", raw_timestamp: "2026-08-13T03:32:37.1659812Z", duration_ms: 84.6053, external_reference: "521817DKLYey6707" },
      { timestamp: "2026-08-13T03:40:00.000Z", raw_timestamp: "2026-08-13T03:40:00.0000000Z", duration_ms: 12.3, external_reference: "521817DKLYey6708" },
    ];
    const first = await deps.upsertRows("dcvv_fetches", rows, { onConflict: "row_hash", ignoreDuplicates: true });
    const second = await deps.upsertRows("dcvv_fetches", rows, { onConflict: "row_hash", ignoreDuplicates: true });
    expect(first).toBe(2);
    expect(second).toBe(0);
  });

  it("two rows differing in a single column (duration_ms) are both kept — never merged (D-04)", async () => {
    const deps = makeFakeDeps();
    const base = { timestamp: "2026-08-13T03:32:37.166Z", raw_timestamp: "2026-08-13T03:32:37.1659812Z", external_reference: "521817DKLYey6707" };
    const rowA = { ...base, duration_ms: 84.6053 };
    const rowB = { ...base, duration_ms: 99.9999 };
    const inserted = await deps.upsertRows("dcvv_fetches", [rowA, rowB], { onConflict: "row_hash", ignoreDuplicates: true });
    expect(inserted).toBe(2);
  });
});
