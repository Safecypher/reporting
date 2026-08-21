import ExcelJS from "exceljs";
import { z } from "zod";
import type { RejectedRow } from "../types";

/** The "APIGEE Calls" sheet is matched BY NAME (never index) — D-11/D-08. */
const APIGEE_SHEET_NAME = "APIGEE Calls";

export interface RawApigeeRow {
  time: unknown;
  pathSuffix: unknown;
  responseCode: unknown;
}

/**
 * Excel's 1900-based date serial. Defensive fallback only (A3) — the real
 * sample's Time column always arrives as a JS Date via ExcelJS's built-in
 * numFmt coercion, but a future export using a non-built-in date format
 * could hand back a raw number instead.
 */
function excelSerialToDate(serial: number): Date {
  // Excel epoch is 1899-12-30 (accounts for the historical 1900 leap-year bug).
  const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
  return new Date(EXCEL_EPOCH_MS + serial * 86_400_000);
}

export const ApigeeRowSchema = z.object({
  time: z
    .union([z.date(), z.number()])
    .transform((v) => (v instanceof Date ? v : excelSerialToDate(v)))
    .refine((d) => Number.isFinite(d.getTime()), "unparseable Time value"),
  pathSuffix: z.string().min(1, "missing what_proxy_pathsuffix"),
  responseCode: z.coerce.number({ error: "invalid response_code" }).int("invalid response_code"),
});

export type ApigeeRow = z.infer<typeof ApigeeRowSchema>;

/**
 * Load the Thesis "Safecypher Stats" workbook with ExcelJS and read only the
 * "APIGEE Calls" sheet, by name (never index — sheet order is not a
 * classification guarantee, and "Verify Outcome" must never be touched, D-08).
 *
 * CRITICAL (Pitfall 1, T-02-A4): the real sample file has a saved AutoFilter
 * marking 28 of 46 data rows `hidden`. This is leftover Excel UI state from
 * the source author's last session, NOT a data-scoping instruction — every
 * row is a real APIGEE call event. `row.hidden` is deliberately never
 * checked here.
 */
export async function parseApigeeStats(bytes: Uint8Array): Promise<RawApigeeRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch (err) {
    // T-02-A1: a crafted/corrupt/zip-bomb XLSX must become a clean rejection,
    // never an unguarded crash.
    const reason = err instanceof Error ? err.message : "unreadable XLSX file";
    throw new Error(`could not load Thesis workbook: ${reason}`);
  }

  const sheet = workbook.getWorksheet(APIGEE_SHEET_NAME);
  if (!sheet) {
    throw new Error(`Thesis workbook is missing the "${APIGEE_SHEET_NAME}" sheet`);
  }

  const rows: RawApigeeRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header row — not a data row
    // NO row.hidden check — see doc comment above (Pitfall 1).
    rows.push({
      time: row.getCell(1).value,
      pathSuffix: row.getCell(2).value,
      responseCode: row.getCell(3).value,
    });
  });

  return rows;
}

/**
 * Validate every raw parsed row against `ApigeeRowSchema`. Malformed rows
 * are never silently dropped — each is reported with a specific per-row
 * reason (INGEST-04, ASVS V5).
 */
export function validateApigeeRows(rows: RawApigeeRow[]): {
  valid: ApigeeRow[];
  rejected: RejectedRow[];
} {
  const valid: ApigeeRow[] = [];
  const rejected: RejectedRow[] = [];

  rows.forEach((row, index) => {
    const result = ApigeeRowSchema.safeParse(row);
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
