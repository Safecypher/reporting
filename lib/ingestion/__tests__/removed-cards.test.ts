import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import { removedCardsHandler } from "../handlers/removed-cards";
import {
  parseRemovedCards,
  validateRemovedCardsRows,
  RemovedCardsRowSchema,
} from "../parsers/removed-cards";
import { normaliseRemovedCards } from "../normalise-removed-cards";
import type { IngestDeps, ReportType } from "../types";

const FIXTURE_PATH = join(__dirname, "removed-cards.fixture.csv");
const fixtureBytes = new Uint8Array(readFileSync(FIXTURE_PATH));

function parseFixtureHeaderRow(): string[] {
  const text = new TextDecoder("utf-8").decode(fixtureBytes);
  const parsed = Papa.parse<Record<string, string>>(text, { header: true });
  return parsed.meta.fields ?? [];
}

describe("classify (removed-cards)", () => {
  it("classifies the removed-cards report from the real fixture header (BOM-tolerant)", () => {
    const headerRow = parseFixtureHeaderRow();
    expect(headerRow[0]).toBe("RemovedAt");
    expect(
      removedCardsHandler.classify("removed-cards-report_2026-08-13.csv", {
        kind: "csv",
        headerRow,
      })
    ).toBe(true);
  });

  it("classifies by header signature alone, even with an unrelated filename", () => {
    const headerRow = parseFixtureHeaderRow();
    expect(removedCardsHandler.classify("upload.csv", { kind: "csv", headerRow })).toBe(true);
  });

  it("returns false for an unrecognised header/filename", () => {
    expect(
      removedCardsHandler.classify("random.csv", { kind: "csv", headerRow: ["a", "b"] })
    ).toBe(false);
  });
});

describe("parseRemovedCards", () => {
  it("parses the real 3-line fixture (header + 2 data rows) and asserts the first header key is exactly RemovedAt", () => {
    const { headerRow, rows } = parseRemovedCards(fixtureBytes);
    expect(headerRow[0]).toBe("RemovedAt");
    expect(rows.length).toBe(2);
  });

  it("throws loudly when an expected column is missing", () => {
    const badCsv = "RemovedAt\n2026-08-13T01:00:00.000\n";
    expect(() => parseRemovedCards(new TextEncoder().encode(badCsv))).toThrow();
  });
});

describe("RemovedCardsRowSchema / validateRemovedCardsRows", () => {
  it("rejects a row with an unparseable RemovedAt with a specific reason, and keeps valid rows", () => {
    const { rows } = parseRemovedCards(fixtureBytes);
    const crafted = [
      { ...rows[0], RemovedAt: "not-a-date" }, // unparseable
      rows[1], // valid
    ];
    const { valid, rejected } = validateRemovedCardsRows(crafted);
    expect(valid.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reasons).toContain("unparseable timestamp");
  });

  it("rejects a row with a missing ExternalCardReference with a specific reason", () => {
    const { rows } = parseRemovedCards(fixtureBytes);
    const crafted = [{ ...rows[0], ExternalCardReference: "" }];
    const { rejected } = validateRemovedCardsRows(crafted);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reasons).toContain("missing card reference");
  });

  it("schema directly rejects an empty RemovedAt as missing", () => {
    const result = RemovedCardsRowSchema.safeParse({
      RemovedAt: "",
      ExternalCardReference: "ABC123",
    });
    expect(result.success).toBe(false);
  });
});

describe("normaliseRemovedCards", () => {
  it("maps a naive RemovedAt to UTC and retains raw_removed_at, without applying an offset, and produces NO report_date field", () => {
    const target = { RemovedAt: "2026-08-13T01:23:37.823", ExternalCardReference: "ABC123" };
    const { rows: normalisedRows } = normaliseRemovedCards([target]);
    expect(normalisedRows.length).toBe(1);
    expect(normalisedRows[0].removed_at).toBe("2026-08-13T01:23:37.823Z");
    expect(normalisedRows[0].raw_removed_at).toBe("2026-08-13T01:23:37.823");
    expect(normalisedRows[0].external_card_reference).toBe("ABC123");
    expect(normalisedRows[0]).not.toHaveProperty("report_date");
  });

  it("excludes rows before 2026-08-13T00:00:00Z (DATA-06) and COUNTS them (excludedPreWindow) — no silent drop", () => {
    // The real fixture's 2 rows are both dated 2026-08-12 — entirely pre-window.
    const { rows } = parseRemovedCards(fixtureBytes);
    const { valid } = validateRemovedCardsRows(rows);
    expect(valid.length).toBe(2);
    const { rows: normalisedRows, excludedPreWindow } = normaliseRemovedCards(valid);
    expect(normalisedRows.length).toBe(0);
    expect(excludedPreWindow).toBe(2);
    // Full accounting: kept + excluded === total valid (CR-02).
    expect(normalisedRows.length + excludedPreWindow).toBe(valid.length);
  });

  it("keeps two rows differing only in RemovedAt or only in ExternalCardReference as two distinct rows", () => {
    const rowA = { RemovedAt: "2026-08-13T01:00:00.000", ExternalCardReference: "AAA111" };
    const rowB = { RemovedAt: "2026-08-13T02:00:00.000", ExternalCardReference: "AAA111" }; // differs by time only
    const rowC = { RemovedAt: "2026-08-13T01:00:00.000", ExternalCardReference: "BBB222" }; // differs by card only
    const { rows: normalisedRows, excludedPreWindow } = normaliseRemovedCards([rowA, rowB, rowC]);
    expect(normalisedRows.length).toBe(3);
    expect(excludedPreWindow).toBe(0);
  });
});

/**
 * Local fake deps mirroring the shared `makeFakeDeps().upsertRows` generic
 * dedup behaviour (see ingestion.test.ts) — a per-table Set keyed on the
 * full row content when `onConflict === "row_hash"`, matching the DB's
 * whole-row-hash `GENERATED ALWAYS ... STORED` semantics (T-02-R1).
 */
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
      throw new Error("upsertVerifications should not be called by the removed-cards handler");
    },
    async upsertRows(table: string, rows: Record<string, unknown>[]) {
      if (rows.length === 0) return 0;
      let keys = upsertedKeysByTable.get(table);
      if (!keys) {
        keys = new Set<string>();
        upsertedKeysByTable.set(table, keys);
      }
      let inserted = 0;
      for (const row of rows) {
        // Whole-row-hash dedup fake: over raw_removed_at + external_card_reference,
        // mirroring the real migration's `md5(raw_removed_at || external_card_reference)`.
        const dedupKey = `${row.raw_removed_at}|${row.external_card_reference}`;
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

describe("removed-cards end-to-end handler (registry contract)", () => {
  it("parses, validates, normalises and upserts synthetic post-window rows via handler methods, with full accounting", async () => {
    const deps = makeFakeDeps();
    const csv =
      "RemovedAt,ExternalCardReference\n" +
      "2026-08-13T01:00:00.000,AAA111\n" +
      "2026-08-13T02:00:00.000,BBB222\n" +
      "not-a-date,CCC333\n"; // rejected row
    const bytes = new TextEncoder().encode(csv);

    const { rawRows } = await removedCardsHandler.parse(bytes, "removed-cards-report_2026-08-13.csv");
    const { valid, rejected } = removedCardsHandler.validate(rawRows);
    const { rows: normalised, excludedPreWindow } = removedCardsHandler.normalise(valid);
    const inserted = await removedCardsHandler.upsert(deps, normalised);
    const duplicates = normalised.length - inserted;

    expect(valid.length).toBe(2);
    expect(rejected.length).toBe(1);
    expect(normalised.length).toBe(2);
    expect(excludedPreWindow).toBe(0);
    expect(inserted).toBe(2);
    expect(duplicates).toBe(0);
    // Full accounting: accepted + duplicates + rejected + excluded === total parsed rows.
    expect(inserted + duplicates + rejected.length + excludedPreWindow).toBe(3);
  });

  it("re-ingesting identical normalised rows via upsert yields 0 new inserts (idempotency, T-02-R1)", async () => {
    const deps = makeFakeDeps();
    const csv =
      "RemovedAt,ExternalCardReference\n" +
      "2026-08-13T01:00:00.000,AAA111\n";
    const bytes = new TextEncoder().encode(csv);

    const { rawRows } = await removedCardsHandler.parse(bytes, "removed-cards-report_2026-08-13.csv");
    const { valid } = removedCardsHandler.validate(rawRows);
    const { rows: normalised } = removedCardsHandler.normalise(valid);

    const firstInsert = await removedCardsHandler.upsert(deps, normalised);
    const secondInsert = await removedCardsHandler.upsert(deps, normalised);
    expect(firstInsert).toBe(1);
    expect(secondInsert).toBe(0);
  });
});
