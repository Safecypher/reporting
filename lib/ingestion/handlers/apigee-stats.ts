import { matchesHeader } from "../classify";
import { normaliseApigee } from "../normalise-apigee";
import { parseApigeeStats, validateApigeeRows } from "../parsers/apigee-stats";
import type { HeaderSignature, IngestDeps, ReportHandler } from "../types";

/** D-11 header signature for the "APIGEE Calls" sheet only. */
const APIGEE_HEADER = ["Time", "what_proxy_pathsuffix", "response_code"] as const;
const APIGEE_SHEET_NAME = "APIGEE Calls";

/**
 * Thesis "Safecypher Stats" XLSX — reads only the "APIGEE Calls" sheet
 * (D-08), decodes the Time column to a real timestamptz (D-10), derives
 * endpoint_category/external_card_reference (D-09), and de-duplicates on a
 * DB-generated whole-row hash (`apigee_calls.row_hash`).
 *
 * NEVER matches on filename (D-11) — the real sample is
 * `Copy of Safecypher Stats 1208 to 1308.xlsx`, which carries no reliable
 * naming convention. Classification requires the sheet name AND the exact
 * 3-column header on an XLSX signature.
 */
export const apigeeStatsHandler: ReportHandler = {
  reportType: "apigee-stats",

  classify(_fileName: string, sig: HeaderSignature): boolean {
    if (sig.kind !== "xlsx") return false;
    return sig.sheetNames.includes(APIGEE_SHEET_NAME) && matchesHeader(sig.headerRow, APIGEE_HEADER);
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
