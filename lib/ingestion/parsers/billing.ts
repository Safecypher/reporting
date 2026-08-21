import Papa from "papaparse";
import { z } from "zod";
import type { RejectedRow } from "../types";

/** The ten columns the billing report must have, post-BOM-strip (D-11). */
const EXPECTED_COLUMNS = [
  "timestamp",
  "transactionDate",
  "transactionTime",
  "processor",
  "issuerBank",
  "transactionId",
  "tokenReference",
  "authorised",
  "verificationKind",
  "region",
] as const;

export const BillingRowSchema = z.object({
  // D-06: unlike verification's naive CreatedAt, `timestamp` is already
  // Z-suffixed UTC — validate parseability directly with Date.parse, do NOT
  // append "Z" (that would double-suffix an already-explicit UTC marker).
  timestamp: z
    .string()
    .min(1, "missing timestamp")
    .refine((v) => Number.isFinite(Date.parse(v)), "unparseable timestamp"),
  transactionDate: z.string().min(1, "missing transaction date"),
  transactionTime: z.string().min(1, "missing transaction time"),
  processor: z.string().min(1, "missing processor"),
  issuerBank: z.string().min(1, "missing issuer bank"),
  transactionId: z.string().min(1, "missing transaction id"),
  tokenReference: z.string().min(1, "missing token reference"),
  // Pitfall 4: `authorised` MUST be validated as an enum, never coerced with
  // Boolean() — the string "False" is truthy in JS and would invert every
  // declined transaction if naively coerced.
  authorised: z.enum(["True", "False"], { error: "invalid authorised value" }),
  verificationKind: z.string().min(1, "missing verification kind"),
  region: z.string().min(1, "missing region"),
});

export type BillingRow = z.infer<typeof BillingRowSchema>;

export interface ParsedBillingFile {
  headerRow: string[];
  /** Raw string-keyed rows exactly as PapaParse produced them (header mode). */
  rows: Record<string, string>[];
}

/**
 * Parse the billing report CSV with PapaParse (header mode) and assert that
 * all ten expected columns are present. PapaParse strips a leading UTF-8 BOM
 * from the decoded string by default (confirmed by the verification parser's
 * analogous test) — a missing column fails loudly here rather than silently
 * producing `undefined` values downstream.
 */
export function parseBilling(bytes: Uint8Array): ParsedBillingFile {
  const text = new TextDecoder("utf-8").decode(bytes);
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  const headerRow = parsed.meta.fields ?? [];
  const missing = EXPECTED_COLUMNS.filter((col) => !headerRow.includes(col));
  if (missing.length > 0) {
    throw new Error(
      `billing report is missing expected column(s): ${missing.join(", ")}`
    );
  }

  return { headerRow, rows: parsed.data };
}

/**
 * Validate every raw parsed row against `BillingRowSchema`. Malformed rows
 * are never silently dropped — each is reported with a specific per-row
 * reason (INGEST-04, ASVS V5). D-05: no row is rejected for being declined
 * (authorised="False") — that is a valid business value, not malformed data.
 */
export function validateBillingRows(rows: Record<string, string>[]): {
  valid: BillingRow[];
  rejected: RejectedRow[];
} {
  const valid: BillingRow[] = [];
  const rejected: RejectedRow[] = [];

  rows.forEach((row, index) => {
    const result = BillingRowSchema.safeParse(row);
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
