import { matchesHeader } from "../classify";
import type { HeaderSignature, ReportHandler } from "../types";

/** D-11 header signature for the "APIGEE Calls" sheet only. */
const APIGEE_HEADER = ["Time", "what_proxy_pathsuffix", "response_code"] as const;
const APIGEE_SHEET_NAME = "APIGEE Calls";

/**
 * Stub handler — real classification is fully wired (D-11) so the Thesis
 * XLSX is correctly routed in Wave 1, but `parse` throws until the Wave 2
 * apigee-stats slice overwrites this module. The CR-01 defensive try/catch
 * in `ingest()` turns this throw into a clean `status: 'failed'` rejection,
 * never a crash.
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

  async parse(): Promise<{ rawRows: Record<string, unknown>[] }> {
    throw new Error("apigee-stats parser not implemented yet");
  },

  validate() {
    return { valid: [], rejected: [] };
  },

  normalise() {
    return { rows: [], excludedPreWindow: 0 };
  },

  async upsert() {
    return 0;
  },
};
