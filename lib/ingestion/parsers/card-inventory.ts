import Papa from "papaparse";
import { z } from "zod";
import type { RejectedRow } from "../types";
import { extractReportDateFromFileName } from "../file-date";

/** The two columns the card-inventory report must have, post-BOM-strip. */
const EXPECTED_COLUMNS = ["ExternalCardReference", "CreatedAt"] as const;

export const CardInventoryRowSchema = z.object({
  ExternalCardReference: z.string().min(1, "missing card reference"),
  // CreatedAt here is per-card ENROLMENT time (naive, interpreted as UTC per
  // A1/D-01) — NOT the snapshot day. The snapshot day is `report_date` below,
  // derived from the filename (D-02).
  CreatedAt: z
    .string()
    .min(1, "missing timestamp")
    .refine((v) => Number.isFinite(Date.parse(`${v}Z`)), "unparseable timestamp"),
  // Embedded by parseCardInventory on every row (D-02, race-safety) — not
  // read from the CSV content itself. Must survive validation unchanged so
  // normaliseCardInventory can read it straight off each row with no
  // out-of-band parameter/closure/module state.
  report_date: z.string().min(1, "missing report_date"),
});

export type CardInventoryRow = z.infer<typeof CardInventoryRowSchema>;

export interface ParsedCardInventoryFile {
  headerRow: string[];
  /**
   * Raw string-keyed rows exactly as PapaParse produced them, PLUS the
   * filename-derived `report_date` embedded onto every row object (plain
   * per-call data — never held in a closure/module variable shared between
   * concurrent parse() calls, so two uploads processed concurrently in the
   * same Node process can never cross-contaminate report_date, D-02).
   */
  rows: Record<string, string>[];
}

/**
 * Parse the card-inventory report CSV with PapaParse (header mode), assert
 * the two expected columns are present, and derive the snapshot
 * `report_date` from the FILENAME (D-02) — `CreatedAt` is per-card enrolment
 * time, not the snapshot day, so it must never be used for report_date.
 *
 * A filename with no parseable `YYYY-MM-DD` date immediately before the
 * extension is a HARD REJECT (throws) — never silently defaulted to "today"
 * (Pitfall 2). The caller (`ingest()`'s CR-01 defensive try/catch) turns
 * this throw into a clean `status: 'failed'` rejection with the thrown
 * message as the reason, never a crash or a silently-wrong snapshot day.
 */
export function parseCardInventory(
  bytes: Uint8Array,
  fileName: string
): ParsedCardInventoryFile {
  const text = new TextDecoder("utf-8").decode(bytes);
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  const headerRow = parsed.meta.fields ?? [];
  const missing = EXPECTED_COLUMNS.filter((col) => !headerRow.includes(col));
  if (missing.length > 0) {
    throw new Error(
      `card-inventory report is missing expected column(s): ${missing.join(", ")}`
    );
  }

  const reportDate = extractReportDateFromFileName(fileName);
  if (reportDate === null) {
    throw new Error(
      `card-inventory filename has no parseable report date: "${fileName}" ` +
        `(expected a YYYY-MM-DD date immediately before the file extension, ` +
        `e.g. card-inventory-report_2026-08-13.csv) — refusing to default to today`
    );
  }

  // Embed report_date on each row object individually (plain per-call data),
  // never as an out-of-band value returned alongside the rows.
  const rows = parsed.data.map((row) => ({ ...row, report_date: reportDate }));

  return { headerRow, rows };
}

/**
 * Validate every raw parsed row against `CardInventoryRowSchema`. Malformed
 * rows are never silently dropped — each is reported with a specific
 * per-row reason (INGEST-04, ASVS V5). The embedded `report_date` field
 * must round-trip through validation unchanged so normalisation can read it
 * straight off each row.
 */
export function validateCardInventoryRows(rows: Record<string, string>[]): {
  valid: CardInventoryRow[];
  rejected: RejectedRow[];
} {
  const valid: CardInventoryRow[] = [];
  const rejected: RejectedRow[] = [];

  rows.forEach((row, index) => {
    const result = CardInventoryRowSchema.safeParse(row);
    if (result.success) {
      valid.push(result.data);
    } else {
      rejected.push({
        row: index + 1,
        reasons: result.error.issues.map((issue) => issue.message),
      });
    }
  });

  return { valid, rejected };
}
