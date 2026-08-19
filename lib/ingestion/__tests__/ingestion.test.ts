import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import { classify } from "../classify";
import { sha256 } from "../hash";
import { parseVerification, validateVerificationRows } from "../parsers/verification";
import { normaliseVerification } from "../normalise";
import { ingest } from "../index";
import type { IngestDeps, NormalisedVerificationRow } from "../types";

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
    const [normalised] = normaliseVerification([target!]);
    expect(normalised.created_at).toBe("2026-08-13T01:23:37.823Z");
    expect(normalised.raw_created_at).toBe("2026-08-13T01:23:37.823");
  });

  it("excludes rows dated before 2026-08-13T00:00:00Z (DATA-06)", () => {
    const { rows } = parseVerification(fixtureBytes);
    const { valid } = validateVerificationRows(rows);
    const normalised = normaliseVerification(valid);
    // The real fixture contains 23 rows from 2026-08-12 and 2 from 2026-08-13.
    expect(valid.length).toBe(25);
    expect(normalised.length).toBe(2);
    expect(normalised.every((r) => Date.parse(r.created_at) >= Date.parse("2026-08-13T00:00:00Z"))).toBe(true);
  });
});

function makeFakeDeps(): IngestDeps & {
  filesByHash: Map<string, { id: string; uploaded_at: string }>;
  storedRows: NormalisedVerificationRow[];
} {
  const filesByHash = new Map<string, { id: string; uploaded_at: string }>();
  const storedRowKeys = new Set<string>();
  const storedRows: NormalisedVerificationRow[] = [];
  let nextId = 1;

  return {
    filesByHash,
    storedRows,
    async findFileByHash(sha256Hex: string) {
      return filesByHash.get(sha256Hex) ?? null;
    },
    async recordFile(meta) {
      const id = `file-${nextId++}`;
      filesByHash.set(meta.contentSha256, { id, uploaded_at: new Date().toISOString() });
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
    async finalizeFile() {
      // no-op fake — production writer updates ingested_files status/counts
    },
  };
}

describe("ingest", () => {
  it("ingests the real fixture: 2 accepted (post-cutoff), 0 duplicates, 0 rejected", async () => {
    const deps = makeFakeDeps();
    const result = await ingest(
      { fileName: "daily-ver-report_2026-08-13.csv", bytes: fixtureBytes, uploadedBy: "user-1" },
      deps
    );
    expect(result.reportType).toBe("verification");
    expect(result.accepted).toBe(2);
    expect(result.duplicates).toBe(0);
    expect(result.rejected).toBe(0);
    expect(result.ingestedFileId).not.toBeNull();
  });

  it("returns alreadyUploaded on a repeat ingest of the identical file content", async () => {
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
    expect(second.accepted).toBe(0);
    expect(second.duplicates).toBe(0);
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
  });
});
