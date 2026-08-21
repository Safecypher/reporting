import { matchesHeader } from "../classify";
import type { HeaderSignature, ReportHandler } from "../types";

/** D-11 header signature — real sample columns, in order, once any BOM is stripped. */
const CARD_INVENTORY_HEADER = ["ExternalCardReference", "CreatedAt"] as const;

/**
 * Stub handler — real classification is fully wired (D-11) so card-inventory
 * files are correctly routed in Wave 1, but `parse` throws until the Wave 2
 * card-inventory slice overwrites this module. The CR-01 defensive try/catch
 * in `ingest()` turns this throw into a clean `status: 'failed'` rejection,
 * never a crash.
 */
export const cardInventoryHandler: ReportHandler = {
  reportType: "card-inventory",

  classify(fileName: string, sig: HeaderSignature): boolean {
    const filenameMatches = fileName.toLowerCase().includes("card-inventory");
    const headerMatches = sig.kind === "csv" && matchesHeader(sig.headerRow, CARD_INVENTORY_HEADER);
    return filenameMatches || headerMatches;
  },

  async parse(): Promise<{ rawRows: Record<string, unknown>[] }> {
    throw new Error("card-inventory parser not implemented yet");
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
