import { matchesHeader } from "../classify";
import type { HeaderSignature, ReportHandler } from "../types";

/** D-11 header signature — real sample columns, in order, once any BOM is stripped. */
const REMOVED_CARDS_HEADER = ["RemovedAt", "ExternalCardReference"] as const;

/**
 * Stub handler — real classification is fully wired (D-11) so removed-cards
 * files are correctly routed in Wave 1, but `parse` throws until the Wave 2
 * removed-cards slice overwrites this module. The CR-01 defensive try/catch
 * in `ingest()` turns this throw into a clean `status: 'failed'` rejection,
 * never a crash.
 */
export const removedCardsHandler: ReportHandler = {
  reportType: "removed-cards",

  classify(fileName: string, sig: HeaderSignature): boolean {
    const filenameMatches = fileName.toLowerCase().includes("removed-cards");
    const headerMatches = sig.kind === "csv" && matchesHeader(sig.headerRow, REMOVED_CARDS_HEADER);
    return filenameMatches || headerMatches;
  },

  async parse(): Promise<{ rawRows: Record<string, unknown>[] }> {
    throw new Error("removed-cards parser not implemented yet");
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
