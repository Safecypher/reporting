import Papa from "papaparse";
import { z } from "zod";
import type { RejectedRow } from "../types";

/** The three columns the dCVV report must have, post-BOM-strip. */
const EXPECTED_COLUMNS = ["timestamp", "duration", "ExternalReference"] as const;

export const DcvvRowSchema = z.object({
  // Unlike verification's naive CreatedAt (A1), dCVV's timestamp is already
  // Z-suffixed (confirmed UTC) — parsed directly with no appended "Z".
  timestamp: z
    .string()
    .min(1, "missing timestamp")
    .refine((v) => Number.isFinite(Date.parse(v)), "unparseable timestamp"),
  duration: z.coerce.number({ error: "invalid duration" }).nonnegative("invalid duration"),
  ExternalReference: z.string().min(1, "missing external reference"),
});

export type DcvvRow = z.infer<typeof DcvvRowSchema>;

export interface ParsedDcvvFile {
  headerRow: string[];
  /** Raw string-keyed rows exactly as PapaParse produced them (header mode). */
  rows: Record<string, string>[];
}

/**
 * Parse the daily-dCVV report CSV with PapaParse (header mode) and assert
 * that all three expected columns are present. PapaParse strips a leading
 * UTF-8 BOM from the decoded string by default (Pitfall 4).
 */
export function parseDcvv(bytes: Uint8Array): ParsedDcvvFile {
  const text = new TextDecoder("utf-8").decode(bytes);
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  const headerRow = parsed.meta.fields ?? [];
  const missing = EXPECTED_COLUMNS.filter((col) => !headerRow.includes(col));
  if (missing.length > 0) {
    throw new Error(`dcvv report is missing expected column(s): ${missing.join(", ")}`);
  }

  return { headerRow, rows: parsed.data };
}

/**
 * Validate every raw parsed row against `DcvvRowSchema`. Malformed rows are
 * never silently dropped — each is reported with a specific per-row reason
 * (INGEST-04, ASVS V5).
 */
export function validateDcvvRows(rows: Record<string, string>[]): {
  valid: DcvvRow[];
  rejected: RejectedRow[];
} {
  const valid: DcvvRow[] = [];
  const rejected: RejectedRow[] = [];

  rows.forEach((row, index) => {
    const result = DcvvRowSchema.safeParse(row);
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
