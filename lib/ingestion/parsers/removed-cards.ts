import Papa from "papaparse";
import { z } from "zod";
import type { RejectedRow } from "../types";

/** The two columns the removed-cards report must have, post-BOM-strip. */
const EXPECTED_COLUMNS = ["RemovedAt", "ExternalCardReference"] as const;

export const RemovedCardsRowSchema = z.object({
  // D-01 (mirrors A1): RemovedAt is a naive timestamp interpreted as UTC.
  // Require that it is actually parseable so a garbage value is REJECTED
  // here with a reason rather than silently dropped in normalisation
  // (CR-02) — the parser's contract is that no malformed row disappears
  // untracked.
  RemovedAt: z
    .string()
    .min(1, "missing timestamp")
    .refine((v) => Number.isFinite(Date.parse(`${v}Z`)), "unparseable timestamp"),
  ExternalCardReference: z.string().min(1, "missing card reference"),
});

export type RemovedCardsRow = z.infer<typeof RemovedCardsRowSchema>;

export interface ParsedRemovedCardsFile {
  headerRow: string[];
  /** Raw string-keyed rows exactly as PapaParse produced them (header mode). */
  rows: Record<string, string>[];
}

/**
 * Parse the removed-cards report CSV with PapaParse (header mode) and assert
 * that both expected columns are present. PapaParse strips a leading UTF-8
 * BOM from the decoded string by default, but a missing column still fails
 * loudly here rather than silently producing `undefined` removed_at values
 * (mirrors parsers/verification.ts Pitfall 4).
 */
export function parseRemovedCards(bytes: Uint8Array): ParsedRemovedCardsFile {
  const text = new TextDecoder("utf-8").decode(bytes);
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  const headerRow = parsed.meta.fields ?? [];
  const missing = EXPECTED_COLUMNS.filter((col) => !headerRow.includes(col));
  if (missing.length > 0) {
    throw new Error(
      `removed-cards report is missing expected column(s): ${missing.join(", ")}`
    );
  }

  return { headerRow, rows: parsed.data };
}

/**
 * Validate every raw parsed row against `RemovedCardsRowSchema`. Malformed
 * rows are never silently dropped — each is reported with a specific
 * per-row reason (INGEST-04, ASVS V5).
 */
export function validateRemovedCardsRows(rows: Record<string, string>[]): {
  valid: RemovedCardsRow[];
  rejected: RejectedRow[];
} {
  const valid: RemovedCardsRow[] = [];
  const rejected: RejectedRow[] = [];

  rows.forEach((row, index) => {
    const result = RemovedCardsRowSchema.safeParse(row);
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
