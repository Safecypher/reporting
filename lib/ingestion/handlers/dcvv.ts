import { matchesHeader } from "../classify";
import { normaliseDcvv } from "../normalise-dcvv";
import { parseDcvv, validateDcvvRows } from "../parsers/dcvv";
import type { HeaderSignature, IngestDeps, ReportHandler } from "../types";

/** D-11 header signature — real sample columns, in order, once any BOM is stripped. */
const DCVV_HEADER = ["timestamp", "duration", "ExternalReference"] as const;

/**
 * dCVV wrapped as a `ReportHandler` (Wave 2 slice). No natural key exists for
 * a dCVV fetch event, so `upsert` delegates to the generic
 * `deps.upsertRows("dcvv_fetches", rows, { onConflict: "row_hash" })` —
 * `row_hash` is a DB `GENERATED ALWAYS ... STORED` md5 over
 * (raw_timestamp + duration_ms + external_reference) (D-04), never computed
 * in TS.
 */
export const dcvvHandler: ReportHandler = {
  reportType: "dcvv",

  classify(fileName: string, sig: HeaderSignature): boolean {
    const filenameMatches = fileName.toLowerCase().includes("daily-dcvv");
    const headerMatches = sig.kind === "csv" && matchesHeader(sig.headerRow, DCVV_HEADER);
    return filenameMatches || headerMatches;
  },

  async parse(bytes: Uint8Array) {
    const parsed = parseDcvv(bytes);
    return { rawRows: parsed.rows as unknown as Record<string, unknown>[] };
  },

  validate(rawRows: Record<string, unknown>[]) {
    return validateDcvvRows(rawRows as unknown as Record<string, string>[]);
  },

  normalise(valid: unknown[]) {
    const result = normaliseDcvv(valid as Parameters<typeof normaliseDcvv>[0]);
    return {
      rows: result.rows as unknown as Record<string, unknown>[],
      excludedPreWindow: result.excludedPreWindow,
    };
  },

  async upsert(deps: IngestDeps, rows: Record<string, unknown>[]) {
    return deps.upsertRows("dcvv_fetches", rows, { onConflict: "row_hash", ignoreDuplicates: true });
  },
};
