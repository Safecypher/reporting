import { matchesHeader } from "../classify";
import { normaliseApigee } from "../normalise-apigee";
import { parseApigeeStats, validateApigeeRows } from "../parsers/apigee-stats";
import type { HeaderSignature, IngestDeps, ReportHandler } from "../types";

/** D-11 header signature for the "APIGEE Calls" sheet only. */
const APIGEE_HEADER = ["Time", "what_proxy_pathsuffix", "response_code"] as const;
const APIGEE_SHEET_NAME = "APIGEE Calls";

/**
 * From the "Safecypher Stats 0710 to 0810" export (Oct 2026) onward TSYS appends a fourth column,
 * `trace_id`, to the "APIGEE Calls" sheet. The parser reads cells 1-3 by
 * position and never touches column D, so the column is harmless to ingest —
 * but the exact-length header match rejected every file carrying it as an
 * "Unrecognised file". Accept the original 3-column header, or the same three
 * columns followed by exactly this trailing column. Anything else (an
 * unknown 4th column, a 5th column, `trace_id` anywhere but last) stays
 * unrecognised, so a future TSYS layout change still fails loudly rather than
 * being silently half-read.
 */
const APIGEE_OPTIONAL_TRAILING_COLUMN = "trace_id";

function matchesApigeeHeader(header: string[]): boolean {
  if (matchesHeader(header, APIGEE_HEADER)) return true;
  return matchesHeader(header, [...APIGEE_HEADER, APIGEE_OPTIONAL_TRAILING_COLUMN]);
}

/**
 * Thesis "Safecypher Stats" XLSX — reads only the "APIGEE Calls" sheet
 * (D-08), decodes the Time column to a real timestamptz (D-10), derives
 * endpoint_category/external_card_reference (D-09), and de-duplicates on a
 * DB-generated whole-row hash (`apigee_calls.row_hash`).
 *
 * NEVER matches on filename (D-11) — the real sample is
 * `Copy of Safecypher Stats 1208 to 1308.xlsx`, which carries no reliable
 * naming convention. Classification requires the sheet name AND the exact
 * 3-column header (optionally followed by the trailing `trace_id` column,
 * see `matchesApigeeHeader`) on an XLSX signature.
 */
export const apigeeStatsHandler: ReportHandler = {
  reportType: "apigee-stats",

  classify(_fileName: string, sig: HeaderSignature): boolean {
    if (sig.kind !== "xlsx") return false;
    // CR-02: read the header of the sheet WE name, not worksheets[0]. The
    // Thesis workbook is multi-tab ("APIGEE Calls" + "Verify Outcome") with no
    // guaranteed tab order — matching by index-0 header silently failed the
    // whole source, contradicting the D-08/D-11 "match by name, never index"
    // principle the parser already follows.
    const header = sig.headerRowsBySheet[APIGEE_SHEET_NAME] ?? [];
    return sig.sheetNames.includes(APIGEE_SHEET_NAME) && matchesApigeeHeader(header);
  },

  async parse(bytes: Uint8Array): Promise<{ rawRows: Record<string, unknown>[] }> {
    const rawRows = await parseApigeeStats(bytes);
    return { rawRows: rawRows as unknown as Record<string, unknown>[] };
  },

  validate(rawRows: Record<string, unknown>[]) {
    return validateApigeeRows(rawRows as unknown as Parameters<typeof validateApigeeRows>[0]);
  },

  normalise(valid: unknown[]) {
    const result = normaliseApigee(valid as Parameters<typeof normaliseApigee>[0]);
    return {
      rows: result.rows as unknown as Record<string, unknown>[],
      excludedPreWindow: result.excludedPreWindow,
    };
  },

  async upsert(deps: IngestDeps, rows: Record<string, unknown>[]) {
    return deps.upsertRows("apigee_calls", rows, { onConflict: "row_hash", ignoreDuplicates: true });
  },
};
