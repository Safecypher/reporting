import Papa from "papaparse";
import { z } from "zod";
import type { RejectedRow } from "../types";

/** The five columns the verification report must have, post-BOM-strip. */
const EXPECTED_COLUMNS = [
  "CreatedAt",
  "ExternalCardReference",
  "Cvi2Value",
  "duration",
  "Authenticated",
] as const;

export const VerificationRowSchema = z.object({
  // A1: CreatedAt is a naive timestamp interpreted as UTC. Require that it is
  // actually parseable so a garbage value is REJECTED here with a reason rather
  // than silently dropped in normalisation (see CR-02) — the parser's contract
  // is that no malformed row disappears untracked.
  CreatedAt: z
    .string()
    .min(1, "missing timestamp")
    .refine((v) => Number.isFinite(Date.parse(`${v}Z`)), "unparseable timestamp"),
  ExternalCardReference: z.string().min(1, "missing card reference"),
  Cvi2Value: z.coerce.number({ error: "invalid Cvi2Value" }).int("invalid Cvi2Value"),
  duration: z.coerce.number({ error: "invalid duration" }).nonnegative("invalid duration"),
  Authenticated: z.enum(["True", "False"], { error: "invalid Authenticated value" }),
});

export type VerificationRow = z.infer<typeof VerificationRowSchema>;

export interface ParsedVerificationFile {
  headerRow: string[];
  /** Raw string-keyed rows exactly as PapaParse produced them (header mode). */
  rows: Record<string, string>[];
}

/**
 * Parse the verification report CSV with PapaParse (header mode) and assert
 * that all five expected columns are present. PapaParse strips a leading
 * UTF-8 BOM from the decoded string by default, but Pitfall 4 requires this
 * to be explicitly asserted, not assumed — a missing column fails loudly
 * here rather than silently producing `undefined` created_at values.
 */
export function parseVerification(bytes: Uint8Array): ParsedVerificationFile {
  const text = new TextDecoder("utf-8").decode(bytes);
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  const headerRow = parsed.meta.fields ?? [];
  const missing = EXPECTED_COLUMNS.filter((col) => !headerRow.includes(col));
  if (missing.length > 0) {
    throw new Error(
      `verification report is missing expected column(s): ${missing.join(", ")}`
    );
  }

  return { headerRow, rows: parsed.data };
}

/**
 * Validate every raw parsed row against `VerificationRowSchema`. Malformed
 * rows are never silently dropped — each is reported with a specific
 * per-row reason (INGEST-04, ASVS V5).
 */
export function validateVerificationRows(rows: Record<string, string>[]): {
  valid: VerificationRow[];
  rejected: RejectedRow[];
} {
  const valid: VerificationRow[] = [];
  const rejected: RejectedRow[] = [];

  rows.forEach((row, index) => {
    const result = VerificationRowSchema.safeParse(row);
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
