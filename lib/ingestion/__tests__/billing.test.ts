import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import { classify } from "../classify";
import { parseBilling, validateBillingRows } from "../parsers/billing";
import { normaliseBilling } from "../normalise-billing";
import { ingest } from "../index";
import type { IngestDeps, NormalisedVerificationRow, ReportType } from "../types";

const FIXTURE_PATH = join(__dirname, "billing.fixture.csv");
const fixtureBytes = new Uint8Array(readFileSync(FIXTURE_PATH));

function parseFixtureHeaderRow(): string[] {
  const text = new TextDecoder("utf-8").decode(fixtureBytes);
  const parsed = Papa.parse<Record<string, string>>(text, { header: true });
  return parsed.meta.fields ?? [];
}

describe("classify (billing)", () => {
  it("classifies the billing report from the real fixture header (BOM-tolerant)", () => {
    const headerRow = parseFixtureHeaderRow();
    // PapaParse strips the BOM from the first field when parsing the decoded
    // string (Pitfall 4, D-12) — assert that explicitly before trusting classify().
    expect(headerRow[0]).toBe("timestamp");
    expect(classify("billing-report_2026-08-13.csv", headerRow)).toBe("billing");
  });

  it("classifies by header signature alone, even with an unrelated filename", () => {
    const headerRow = parseFixtureHeaderRow();
    expect(classify("upload.csv", headerRow)).toBe("billing");
  });

  it("returns null for an unrecognised header/filename", () => {
    expect(classify("random.csv", ["a", "b"])).toBeNull();
  });
});

describe("parseBilling", () => {
  it("parses the real fixture and returns all 94 rows", () => {
    const { headerRow, rows } = parseBilling(fixtureBytes);
    expect(headerRow[0]).toBe("timestamp");
    expect(rows.length).toBe(94);
  });

  it("throws loudly when an expected column is missing", () => {
    const badCsv =
      "timestamp,transactionDate,transactionTime,processor,issuerBank,transactionId,tokenReference,authorised\n" +
      "2026-08-13T01:00:00.000Z,2026-08-13,01:00:00,TSYS,Invex,123,tok-1,True\n";
    expect(() => parseBilling(new TextEncoder().encode(badCsv))).toThrow();
  });
});

describe("validateBillingRows", () => {
  it("rejects a row with a missing timestamp with a specific reason, and keeps valid rows", () => {
    const { rows } = parseBilling(fixtureBytes);
    const crafted = [
      { ...rows[0], timestamp: "" }, // missing timestamp
      rows[1], // valid
    ];
    const { valid, rejected } = validateBillingRows(crafted);
    expect(valid.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reasons).toContain("missing timestamp");
  });

  it("rejects a row with a missing transactionId with a specific reason", () => {
    const { rows } = parseBilling(fixtureBytes);
    const crafted = [{ ...rows[0], transactionId: "" }];
    const { rejected } = validateBillingRows(crafted);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reasons).toContain("missing transaction id");
  });

  it("rejects a row whose authorised value is not True/False", () => {
    const { rows } = parseBilling(fixtureBytes);
    const crafted = [{ ...rows[0], authorised: "Maybe" }];
    const { rejected } = validateBillingRows(crafted);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reasons).toContain("invalid authorised value");
  });

  it("rejects a row with an unparseable timestamp with a specific reason", () => {
    const { rows } = parseBilling(fixtureBytes);
    const crafted = [{ ...rows[0], timestamp: "not-a-date" }];
    const { rejected } = validateBillingRows(crafted);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reasons).toContain("unparseable timestamp");
  });

  it("(Pitfall-4 tripwire) the real fixture's authorised split is ~16 True / ~78 False, NOT inverted", () => {
    // This is the critical regression guard: `authorised='False'` must map to
    // boolean false, never truthy-coerced. If a future change swaps
    // `z.enum(["True","False"])` for `Boolean(row.authorised)`, this ratio
    // inverts to ~82% true (every non-empty string is truthy) and this
    // assertion catches it immediately.
    const { rows } = parseBilling(fixtureBytes);
    const { valid } = validateBillingRows(rows);
    const trueCount = valid.filter((r) => r.authorised === "True").length;
    const falseCount = valid.filter((r) => r.authorised === "False").length;
    expect(trueCount).toBe(16);
    expect(falseCount).toBe(78);
    expect(trueCount + falseCount).toBe(valid.length);
  });
});

describe("normaliseBilling", () => {
  it("sets event_time from the Z-suffixed timestamp (canonical, D-06) and retains raw lineage columns", () => {
    const { rows } = parseBilling(fixtureBytes);
    const { valid } = validateBillingRows(rows);
    const target = valid.find((r) => r.transactionId === "120112");
    expect(target).toBeDefined();
    const { rows: normalisedRows } = normaliseBilling([target!]);
    expect(normalisedRows[0].event_time).toBe(
      new Date(target!.timestamp).toISOString()
    );
    expect(normalisedRows[0].raw_transaction_date).toBe(target!.transactionDate);
    expect(normalisedRows[0].raw_transaction_time).toBe(target!.transactionTime);
  });

  it("stores authorised=False rows (D-05 — no row filtering by authorised)", () => {
    const { rows } = parseBilling(fixtureBytes);
    const { valid } = validateBillingRows(rows);
    const declined = valid.find((r) => r.authorised === "False");
    expect(declined).toBeDefined();
    const { rows: normalisedRows } = normaliseBilling([declined!]);
    expect(normalisedRows.length).toBe(1);
    expect(normalisedRows[0].authorised).toBe(false);
  });

  it("applies the DATA-06 cutoff and COUNTS excluded rows — full accounting (CR-02)", () => {
    const { rows } = parseBilling(fixtureBytes);
    const { valid } = validateBillingRows(rows);
    const { rows: normalisedRows, excludedPreWindow } = normaliseBilling(valid);
    // The real fixture has 92 rows before 2026-08-13 and 2 rows on/after it.
    expect(valid.length).toBe(94);
    expect(normalisedRows.length).toBe(2);
    expect(excludedPreWindow).toBe(92);
    expect(normalisedRows.length + excludedPreWindow).toBe(valid.length);
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
    async upsertVerifications(_rows: NormalisedVerificationRow[]) {
      return 0;
    },
    async upsertRows(
      table: string,
      rows: Record<string, unknown>[],
      opts: { onConflict: string }
    ) {
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
    },
  };
}

describe("ingest (billing end-to-end)", () => {
  it("ingests the real fixture: all rows stored (no authorised filtering), full accounting (CR-02)", async () => {
    const deps = makeFakeDeps();
    const result = await ingest(
      { fileName: "billing-report_2026-08-13.csv", bytes: fixtureBytes, uploadedBy: "user-1" },
      deps
    );
    expect(result.reportType).toBe("billing");
    // Every parsed row lands in exactly one bucket.
    expect(result.accepted + result.duplicates + result.rejected + result.excluded).toBe(94);
    // The 2 post-cutoff rows (incl. one authorised=False) are accepted — D-05.
    expect(result.accepted).toBe(2);
    expect(result.excluded).toBe(92);
    expect(result.rejected).toBe(0);
    expect(deps.finalizedStatus()).toBe("done");
  });

  it("returns alreadyUploaded on a repeat ingest of identical bytes (file-hash short-circuit)", async () => {
    const deps = makeFakeDeps();
    await ingest(
      { fileName: "billing-report_2026-08-13.csv", bytes: fixtureBytes, uploadedBy: "user-1" },
      deps
    );
    const second = await ingest(
      { fileName: "billing-report_2026-08-13.csv", bytes: fixtureBytes, uploadedBy: "user-1" },
      deps
    );
    expect(second.alreadyUploaded).toBeDefined();
    expect(second.reportType).toBe("billing");
    expect(second.accepted).toBe(0);
  });

  it("de-duplicates idempotently on transaction_id: a fresh-file re-parse of the same rows collapses to 0 new inserts (D-07)", async () => {
    const { rows } = parseBilling(fixtureBytes);
    const { valid } = validateBillingRows(rows);
    const { rows: normalised } = normaliseBilling(valid);
    const deps = makeFakeDeps();
    const firstInsert = await deps.upsertRows("billing_transactions", normalised, {
      onConflict: "transaction_id",
      ignoreDuplicates: true,
    });
    const secondInsert = await deps.upsertRows("billing_transactions", normalised, {
      onConflict: "transaction_id",
      ignoreDuplicates: true,
    });
    expect(firstInsert).toBe(normalised.length);
    expect(secondInsert).toBe(0);
  });
});
