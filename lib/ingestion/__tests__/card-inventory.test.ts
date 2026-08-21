import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import { classify } from "../classify";
import { ingest } from "../index";
import { parseCardInventory, validateCardInventoryRows } from "../parsers/card-inventory";
import { normaliseCardInventory } from "../normalise-card-inventory";
import type { IngestDeps, ReportType } from "../types";

const FIXTURE_PATH = join(__dirname, "card-inventory.fixture.csv");
const FIXTURE_NAME = "card-inventory-report_2026-08-13.csv";
const fixtureBytes = new Uint8Array(readFileSync(FIXTURE_PATH));

function parseFixtureHeaderRow(): string[] {
  const text = new TextDecoder("utf-8").decode(fixtureBytes);
  const parsed = Papa.parse<Record<string, string>>(text, { header: true });
  return parsed.meta.fields ?? [];
}

describe("classify", () => {
  it("classifies the card-inventory report from the real fixture header (BOM-tolerant)", () => {
    const headerRow = parseFixtureHeaderRow();
    expect(headerRow[0]).toBe("ExternalCardReference");
    expect(classify(FIXTURE_NAME, headerRow)).toBe("card-inventory");
  });

  it("classifies by header signature alone, even with an unrelated filename", () => {
    const headerRow = parseFixtureHeaderRow();
    expect(classify("upload.csv", headerRow)).toBe("card-inventory");
  });

  it("returns null for an unrecognised header/filename", () => {
    expect(classify("random.csv", ["a", "b"])).toBeNull();
  });
});

describe("parseCardInventory", () => {
  it("parses the real fixture: 52 data rows, each carrying report_date derived from the filename (D-02)", () => {
    const { headerRow, rows } = parseCardInventory(fixtureBytes, FIXTURE_NAME);
    expect(headerRow[0]).toBe("ExternalCardReference");
    expect(rows.length).toBe(52);
    // report_date travels embedded on EVERY row object (plain per-call data) —
    // never held in a closure/module variable shared across calls (D-02).
    expect(rows.every((r) => r.report_date === "2026-08-13")).toBe(true);
  });

  it("throws loudly when an expected column is missing", () => {
    const badCsv = "ExternalCardReference\nABC123\n";
    expect(() =>
      parseCardInventory(new TextEncoder().encode(badCsv), FIXTURE_NAME)
    ).toThrow();
  });

  it("throws a clear reason when the filename carries no parseable report date — never defaults to today (D-02, Pitfall 2)", () => {
    expect(() => parseCardInventory(fixtureBytes, "card-inventory-report.csv")).toThrow(
      /report date/i
    );
  });

  it("derives a different report_date for a different filename, proving no shared/module-level state (race-safety)", () => {
    const a = parseCardInventory(fixtureBytes, "card-inventory-report_2026-08-13.csv");
    const b = parseCardInventory(fixtureBytes, "card-inventory-report_2026-08-14.csv");
    expect(a.rows[0].report_date).toBe("2026-08-13");
    expect(b.rows[0].report_date).toBe("2026-08-14");
  });
});

describe("validateCardInventoryRows", () => {
  it("rejects a row with a missing card reference with a specific reason, and keeps valid rows", () => {
    const { rows } = parseCardInventory(fixtureBytes, FIXTURE_NAME);
    const crafted = [
      { ...rows[0], ExternalCardReference: "" },
      rows[1],
    ];
    const { valid, rejected } = validateCardInventoryRows(crafted);
    expect(valid.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reasons).toContain("missing card reference");
  });

  it("rejects a row with an unparseable CreatedAt with a specific reason", () => {
    const { rows } = parseCardInventory(fixtureBytes, FIXTURE_NAME);
    const crafted = [{ ...rows[0], CreatedAt: "not-a-timestamp" }];
    const { rejected } = validateCardInventoryRows(crafted);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reasons).toContain("unparseable timestamp");
  });

  it("preserves the embedded report_date field on every valid row", () => {
    const { rows } = parseCardInventory(fixtureBytes, FIXTURE_NAME);
    const { valid } = validateCardInventoryRows(rows);
    expect(valid.length).toBeGreaterThan(0);
    expect(valid.every((r) => r.report_date === "2026-08-13")).toBe(true);
  });
});

describe("normaliseCardInventory", () => {
  it("threads report_date from the ROW (not derived from CreatedAt), maps CreatedAt to UTC, and retains raw_created_at", () => {
    const { rows } = parseCardInventory(fixtureBytes, FIXTURE_NAME);
    const { valid } = validateCardInventoryRows(rows);
    const target = valid.find((r) => r.CreatedAt === "2026-08-12T19:14:33.59");
    expect(target).toBeDefined();
    const { rows: normalisedRows } = normaliseCardInventory([target!]);
    // This row is before the DATA-06 cutoff (2026-08-13T00:00:00Z), so it is
    // excluded here — assert via the dedicated cutoff test below instead.
    expect(normalisedRows.length).toBe(0);
  });

  it("full accounting: kept + excludedPreWindow === valid.length (CR-02), and report_date on kept rows equals the row's own value", () => {
    const { rows } = parseCardInventory(fixtureBytes, FIXTURE_NAME);
    const { valid } = validateCardInventoryRows(rows);
    const { rows: normalisedRows, excludedPreWindow } = normaliseCardInventory(valid);
    expect(normalisedRows.length + excludedPreWindow).toBe(valid.length);
    expect(normalisedRows.every((r) => r.report_date === "2026-08-13")).toBe(true);
  });
});

function makeFakeDeps(): IngestDeps & {
  finalizedStatus: () => "done" | "failed" | null;
  finalizedReasons: () => string[];
} {
  const filesByHash = new Map<
    string,
    { id: string; uploaded_at: string; report_type: ReportType | null }
  >();
  const upsertedKeysByTable = new Map<string, Set<string>>();
  let lastStatus: "done" | "failed" | null = null;
  let lastReasons: string[] = [];
  let nextId = 1;

  return {
    finalizedStatus: () => lastStatus,
    finalizedReasons: () => lastReasons,
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
      throw new Error("upsertVerifications should not be called by the card-inventory handler");
    },
    async upsertRows(table: string, rows: Record<string, unknown>[], opts: { onConflict: string }) {
      if (rows.length === 0) return 0;
      let keys = upsertedKeysByTable.get(table);
      if (!keys) {
        keys = new Set<string>();
        upsertedKeysByTable.set(table, keys);
      }
      const conflictCols = opts.onConflict.split(",").map((c) => c.trim());
      let inserted = 0;
      for (const row of rows) {
        const dedupKey = conflictCols.map((c) => String(row[c])).join("|");
        if (!keys.has(dedupKey)) {
          keys.add(dedupKey);
          inserted++;
        }
      }
      return inserted;
    },
    async finalizeFile(_id, counts) {
      lastStatus = counts.status;
      lastReasons = counts.rejectReasons.flatMap((r) => r.reasons);
    },
  };
}

describe("ingest", () => {
  it("ingests the real fixture end-to-end with full accounting (CR-02)", async () => {
    const deps = makeFakeDeps();
    const result = await ingest(
      { fileName: FIXTURE_NAME, bytes: fixtureBytes, uploadedBy: "user-1" },
      deps
    );
    expect(result.reportType).toBe("card-inventory");
    expect(result.accepted + result.duplicates + result.rejected + result.excluded).toBe(52);
    expect(result.ingestedFileId).not.toBeNull();
    expect(deps.finalizedStatus()).toBe("done");
  });

  it("re-ingesting the same file (same report_date) is idempotent — 0 new inserts the second time", async () => {
    const deps = makeFakeDeps();
    await ingest(
      { fileName: FIXTURE_NAME, bytes: fixtureBytes, uploadedBy: "user-1" },
      deps
    );
    const second = await ingest(
      { fileName: FIXTURE_NAME, bytes: fixtureBytes, uploadedBy: "user-1" },
      deps
    );
    expect(second.alreadyUploaded).toBeDefined();
    expect(second.reportType).toBe("card-inventory");
    expect(second.accepted).toBe(0);
  });

  it("hard-rejects a card-inventory file whose filename has no parseable date — status:'failed' with a clear reason (D-02, Pitfall 2)", async () => {
    const deps = makeFakeDeps();
    const result = await ingest(
      { fileName: "card-inventory-report.csv", bytes: fixtureBytes, uploadedBy: "user-1" },
      deps
    );
    expect(result.reportType).toBe("card-inventory");
    expect(result.accepted).toBe(0);
    expect(result.rejectReasons.length).toBeGreaterThan(0);
    expect(result.rejectReasons[0].reasons.join(" ")).toMatch(/report date/i);
    expect(deps.finalizedStatus()).toBe("failed");
  });
});
