import { matchesHeader } from "../classify";
import { normaliseRemovedCards } from "../normalise-removed-cards";
import { parseRemovedCards, validateRemovedCardsRows } from "../parsers/removed-cards";
import type { HeaderSignature, IngestDeps, ReportHandler } from "../types";

/** D-11 header signature — real sample columns, in order, once any BOM is stripped. */
const REMOVED_CARDS_HEADER = ["RemovedAt", "ExternalCardReference"] as const;

/**
 * Removed-cards is an event log, not a daily snapshot (D-03): a card is
 * unenrolled once at a known RemovedAt. De-dup is a whole-row hash over
 * (raw_removed_at, external_card_reference) — a DB-generated
 * `GENERATED ALWAYS ... STORED` column (0009_removed_cards.sql), never
 * computed in TypeScript. `upsert` delegates to the generic
 * `deps.upsertRows`, the shared path every Wave 2 handler uses.
 */
export const removedCardsHandler: ReportHandler = {
  reportType: "removed-cards",

  classify(fileName: string, sig: HeaderSignature): boolean {
    const filenameMatches = fileName.toLowerCase().includes("removed-cards");
    const headerMatches = sig.kind === "csv" && matchesHeader(sig.headerRow, REMOVED_CARDS_HEADER);
    return filenameMatches || headerMatches;
  },

  async parse(bytes: Uint8Array) {
    const parsed = parseRemovedCards(bytes);
    return { rawRows: parsed.rows as unknown as Record<string, unknown>[] };
  },

  validate(rawRows: Record<string, unknown>[]) {
    return validateRemovedCardsRows(rawRows as unknown as Record<string, string>[]);
  },

  normalise(valid: unknown[]) {
    const result = normaliseRemovedCards(valid as Parameters<typeof normaliseRemovedCards>[0]);
    return {
      rows: result.rows as unknown as Record<string, unknown>[],
      excludedPreWindow: result.excludedPreWindow,
    };
  },

  async upsert(deps: IngestDeps, rows: Record<string, unknown>[]) {
    return deps.upsertRows("removed_cards", rows, { onConflict: "row_hash", ignoreDuplicates: true });
  },
};
