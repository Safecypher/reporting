import { matchesHeader } from "../classify";
import { normaliseCardInventory } from "../normalise-card-inventory";
import { parseCardInventory, validateCardInventoryRows } from "../parsers/card-inventory";
import type { HeaderSignature, IngestDeps, ReportHandler } from "../types";

/** D-11 header signature — real sample columns, in order, once any BOM is stripped. */
const CARD_INVENTORY_HEADER = ["ExternalCardReference", "CreatedAt"] as const;

/**
 * Card-inventory daily-snapshot handler (Wave 2, Plan 02-04). `report_date`
 * — the snapshot day — is derived from the FILENAME by `parseCardInventory`
 * (D-02), never from `CreatedAt` (per-card enrolment time). Dedup is on
 * `(report_date, external_card_reference)` via the generic `upsertRows`.
 */
export const cardInventoryHandler: ReportHandler = {
  reportType: "card-inventory",

  classify(fileName: string, sig: HeaderSignature): boolean {
    const filenameMatches = fileName.toLowerCase().includes("card-inventory");
    const headerMatches = sig.kind === "csv" && matchesHeader(sig.headerRow, CARD_INVENTORY_HEADER);
    return filenameMatches || headerMatches;
  },

  async parse(bytes: Uint8Array, fileName: string): Promise<{ rawRows: Record<string, unknown>[] }> {
    return { rawRows: parseCardInventory(bytes, fileName).rows as unknown as Record<string, unknown>[] };
  },

  validate(rawRows: Record<string, unknown>[]) {
    return validateCardInventoryRows(rawRows as unknown as Record<string, string>[]);
  },

  normalise(valid: unknown[]) {
    const result = normaliseCardInventory(valid as Parameters<typeof normaliseCardInventory>[0]);
    return {
      rows: result.rows as unknown as Record<string, unknown>[],
      excludedPreWindow: result.excludedPreWindow,
    };
  },

  async upsert(deps: IngestDeps, rows: Record<string, unknown>[]) {
    return deps.upsertRows("card_inventory", rows, {
      onConflict: "report_date,external_card_reference",
      ignoreDuplicates: true,
    });
  },
};
