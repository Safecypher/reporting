import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import { classify } from "../classify";
import { sha256 } from "../hash";
import { parseVerification, validateVerificationRows } from "../parsers/verification";
import { normaliseVerification } from "../normalise";
import { ingest } from "../index";
import type { IngestDeps, NormalisedVerificationRow, ReportType } from "../types";

const FIXTURE_PATH = join(__dirname, "verification.fixture.csv");
const fixtureBytes = new Uint8Array(readFileSync(FIXTURE_PATH));

function parseFixtureHeaderRow(): string[] {
  const text = new TextDecoder("utf-8").decode(fixtureBytes);
  const parsed = Papa.parse<Record<string, string>>(text, { header: true });
  return parsed.meta.fields ?? [];
}

describe("classify", () => {
  it("classifies the verification report from the real fixture header (BOM-tolerant)", () => {
    const headerRow = parseFixtureHeaderRow();
    // PapaParse strips the BOM from the first field when parsing the decoded
    // string (Pitfall 4) — assert that explicitly before trusting classify().
    expect(headerRow[0]).toBe("CreatedAt");
    expect(classify("daily-ver-report_2026-08-13.csv", headerRow)).toBe("verification");
  });

  it("classifies by header signature alone, even with an unrelated filename", () => {
    const headerRow = parseFixtureHeaderRow();
    expect(classify("upload.csv", headerRow)).toBe("verification");
  });

  it("returns null for an unrecognised header/filename", () => {
    expect(classify("random.csv", ["a", "b"])).toBeNull();
  });
});

describe("sha256", () => {
  it("returns a stable 64-char hex string for identical bytes", () => {
    const h1 = sha256(fixtureBytes);
    const h2 = sha256(fixtureBytes);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
  });

  it("returns a different hash for different bytes", () => {
    const other = new TextEncoder().encode("not the same content");
    expect(sha256(fixtureBytes)).not.toBe(sha256(other));
  });
});

describe("parseVerification", () => {
  it("parses the real fixture and asserts the first header key is exactly CreatedAt", () => {
    const { headerRow, rows } = parseVerification(fixtureBytes);
    expect(headerRow[0]).toBe("CreatedAt");
    expect(rows.length).toBe(25);
  });

  it("throws loudly when an expected column is missing", () => {
    const badCsv = "CreatedAt,ExternalCardReference,Cvi2Value,Authenticated\n2026-08-13T01:00:00.000,ABC123,100,True\n";
    expect(() => parseVerification(new TextEncoder().encode(badCsv))).toThrow();
  });
});

describe("validateVerificationRows", () => {
  it("rejects a row with a missing timestamp with a specific reason, and keeps valid rows", () => {
    const { rows } = parseVerification(fixtureBytes);
    const crafted = [
      { ...rows[0], CreatedAt: "" }, // missing timestamp
      rows[1], // valid
    ];
    const { valid, rejected } = validateVerificationRows(crafted);
    expect(valid.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reasons).toContain("missing timestamp");
  });

  it("rejects a row with a non-numeric duration with a specific reason", () => {
    const { rows } = parseVerification(fixtureBytes);
    const crafted = [{ ...rows[0], duration: "not-a-number" }];
    const { rejected } = validateVerificationRows(crafted);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reasons).toContain("invalid duration");
  });

  it("rejects a row whose Authenticated value is not True/False", () => {
    const { rows } = parseVerification(fixtureBytes);
    const crafted = [{ ...rows[0], Authenticated: "Maybe" }];
    const { rejected } = validateVerificationRows(crafted);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reasons).toContain("invalid Authenticated value");
  });
});

describe("normaliseVerification", () => {
  it("maps a naive CreatedAt to UTC and retains raw_created_at, without applying an offset", () => {
    const { rows } = parseVerification(fixtureBytes);
    const { valid } = validateVerificationRows(rows);
    const target = valid.find((r) => r.CreatedAt === "2026-08-13T01:23:37.823");
    expect(target).toBeDefined();
    const { rows: normalisedRows } = normaliseVerification([target!]);
    expect(normalisedRows[0].created_at).toBe("2026-08-13T01:23:37.823Z");
    expect(normalisedRows[0].raw_created_at).toBe("2026-08-13T01:23:37.823");
  });

  it("excludes rows before 2026-08-13T00:00:00Z (DATA-06) and COUNTS them (excludedPreWindow) — no silent drop", () => {
    const { rows } = parseVerification(fixtureBytes);
    const { valid } = validateVerificationRows(rows);
    const { rows: normalisedRows, excludedPreWindow } = normaliseVerification(valid);
    // The real fixture contains 23 rows from 2026-08-12 and 2 from 2026-08-13.
    expect(valid.length).toBe(25);
    expect(normalisedRows.length).toBe(2);
    expect(excludedPreWindow).toBe(23);
    // Full accounting: kept + excluded === total valid (CR-02).
    expect(normalisedRows.length + excludedPreWindow).toBe(valid.length);
    expect(
      normalisedRows.every((r) => Date.parse(r.created_at) >= Date.parse("2026-08-13T00:00:00Z"))
    ).toBe(true);
  });
});

function makeFakeDeps(): IngestDeps & {
  filesByHash: Map<string, { id: string; uploaded_at: string; report_type: ReportType | null }>;
  storedRows: NormalisedVerificationRow[];
  finalizedStatus: () => "done" | "failed" | null;
  finalizedCounts: () => { accepted: number; duplicates: number; rejected: number; excluded: number } | null;
} {
  const filesByHash = new Map<
    string,
    { id: string; uploaded_at: string; report_type: ReportType | null }
  >();
  const storedRowKeys = new Set<string>();
  const storedRows: NormalisedVerificationRow[] = [];
  // Generic upsertRows fake state: one dedup-key Set per table name, mirroring
  // the real writer's per-table UNIQUE constraint (Task 3 behaviour spec).
  const upsertedKeysByTable = new Map<string, Set<string>>();
  let lastStatus: "done" | "failed" | null = null;
  let lastCounts: { accepted: number; duplicates: number; rejected: number; excluded: number } | null = null;
  let nextId = 1;

  return {
    filesByHash,
    storedRows,
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
    async upsertVerifications(rows: NormalisedVerificationRow[]) {
      let inserted = 0;
      for (const row of rows) {
        const key = `${row.created_at}|${row.external_card_reference}|${row.duration_ms}|${row.cvi2_value}|${row.authenticated}`;
        if (!storedRowKeys.has(key)) {
          storedRowKeys.add(key);
          storedRows.push(row);
          inserted++;
        }
      }
      return inserted;
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
      // fake — records what the production writer would persist
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

describe("ingest", () => {
  it("ingests the real fixture: 2 accepted (post-cutoff), 23 excluded (pre-window), 0 rejected — full accounting (CR-02)", async () => {
    const deps = makeFakeDeps();
    const result = await ingest(
      { fileName: "daily-ver-report_2026-08-13.csv", bytes: fixtureBytes, uploadedBy: "user-1" },
      deps
    );
    expect(result.reportType).toBe("verification");
    expect(result.accepted).toBe(2);
    expect(result.duplicates).toBe(0);
    expect(result.rejected).toBe(0);
    // The 23 pre-13-Aug rows are counted, never silently dropped (CR-02).
    expect(result.excluded).toBe(23);
    // Every parsed row is accounted for: accepted + duplicates + rejected + excluded === 25.
    expect(result.accepted + result.duplicates + result.rejected + result.excluded).toBe(25);
    expect(result.ingestedFileId).not.toBeNull();
    expect(deps.finalizedStatus()).toBe("done");
    // The persisted audit counts match the returned result exactly.
    expect(deps.finalizedCounts()).toEqual({ accepted: 2, duplicates: 0, rejected: 0, excluded: 23 });
  });

  it("returns alreadyUploaded (with the real reportType, not null) on a repeat ingest (IN-02)", async () => {
    const deps = makeFakeDeps();
    await ingest(
      { fileName: "daily-ver-report_2026-08-13.csv", bytes: fixtureBytes, uploadedBy: "user-1" },
      deps
    );
    const second = await ingest(
      { fileName: "daily-ver-report_2026-08-13.csv", bytes: fixtureBytes, uploadedBy: "user-1" },
      deps
    );
    expect(second.alreadyUploaded).toBeDefined();
    expect(second.reportType).toBe("verification");
    expect(second.accepted).toBe(0);
    expect(second.duplicates).toBe(0);
    expect(second.excluded).toBe(0);
  });

  it("does not throw and marks status=failed when the filename matches but content is unparsable (CR-01)", async () => {
    const deps = makeFakeDeps();
    // Filename contains 'daily-ver' so classify() matches on name, but the
    // content has none of the expected columns — the second parse would throw.
    const badContent = new TextEncoder().encode("wrong,header\n1,2\n");
    const result = await ingest(
      { fileName: "daily-ver-report-old-format.csv", bytes: badContent, uploadedBy: "user-1" },
      deps
    );
    expect(result.reportType).toBe("verification");
    expect(result.accepted).toBe(0);
    expect(result.ingestedFileId).not.toBeNull();
    expect(result.rejectReasons.length).toBeGreaterThan(0);
    // Must be marked failed (not stuck at 'pending') so it isn't a silent data-loss path.
    expect(deps.finalizedStatus()).toBe("failed");
  });

  it("returns reportType null and a rejection reason for an unrecognised file", async () => {
    const deps = makeFakeDeps();
    const unknownCsv = "a,b\n1,2\n";
    const result = await ingest(
      { fileName: "unknown.csv", bytes: new TextEncoder().encode(unknownCsv), uploadedBy: "user-1" },
      deps
    );
    expect(result.reportType).toBeNull();
    expect(result.rejectReasons[0].reasons).toContain("unrecognised report type");
    // Audit integrity: an unrecognised file must never be marked a successful import.
    expect(deps.finalizedStatus()).toBe("failed");
  });
});

describe("makeFakeDeps().upsertRows (generic dep used by all five Wave 2 handlers)", () => {
  it("dedups idempotently on row_hash: re-inserting identical rows returns 0 the second time", async () => {
    const deps = makeFakeDeps();
    const rows = [{ a: "x", b: 1 }, { a: "y", b: 2 }];
    const firstInsert = await deps.upsertRows("dcvv_fetches", rows, {
      onConflict: "row_hash",
      ignoreDuplicates: true,
    });
    const secondInsert = await deps.upsertRows("dcvv_fetches", rows, {
      onConflict: "row_hash",
      ignoreDuplicates: true,
    });
    expect(firstInsert).toBe(2);
    expect(secondInsert).toBe(0);
  });

  it("dedups idempotently on a composite/natural key: re-inserting the same key returns 0 the second time", async () => {
    const deps = makeFakeDeps();
    const rows = [{ report_date: "2026-08-13", external_card_reference: "ABC", extra: 1 }];
    const firstInsert = await deps.upsertRows("card_inventory", rows, {
      onConflict: "report_date,external_card_reference",
      ignoreDuplicates: true,
    });
    // Same key, different non-key column — still a duplicate on the key.
    const secondInsert = await deps.upsertRows(
      "card_inventory",
      [{ report_date: "2026-08-13", external_card_reference: "ABC", extra: 999 }],
      { onConflict: "report_date,external_card_reference", ignoreDuplicates: true }
    );
    expect(firstInsert).toBe(1);
    expect(secondInsert).toBe(0);
  });

  it("returns 0 for an empty row set without mutating any dedup state", async () => {
    const deps = makeFakeDeps();
    expect(await deps.upsertRows("billing_transactions", [], { onConflict: "transaction_id", ignoreDuplicates: true })).toBe(0);
  });
});
