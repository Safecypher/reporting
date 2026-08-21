import { matchesHeader } from "../classify";
import { normaliseVerification } from "../normalise";
import { parseVerification, validateVerificationRows } from "../parsers/verification";
import type { HeaderSignature, IngestDeps, ReportHandler } from "../types";

/** The five columns the verification report must have, in order, once any BOM is stripped. */
const VERIFICATION_HEADER_SIGNATURE = [
  "CreatedAt",
  "ExternalCardReference",
  "Cvi2Value",
  "duration",
  "Authenticated",
] as const;

/**
 * Verification wrapped as a `ReportHandler` — behaviour-identical to the
 * Phase 1 hardcoded path. `upsert` delegates to the pre-existing
 * `deps.upsertVerifications`, not the new generic `upsertRows`, so this
 * report type's DB-write path (and its tests) are entirely unaffected by
 * the registry refactor (the regression gate this plan exists to satisfy).
 */
export const verificationHandler: ReportHandler = {
  reportType: "verification",

  classify(fileName: string, sig: HeaderSignature): boolean {
    const filenameMatches = fileName.toLowerCase().includes("daily-ver");
    const headerMatches =
      sig.kind === "csv" && matchesHeader(sig.headerRow, VERIFICATION_HEADER_SIGNATURE);
    return filenameMatches || headerMatches;
  },

  async parse(bytes: Uint8Array) {
    const parsed = parseVerification(bytes);
    return { rawRows: parsed.rows as unknown as Record<string, unknown>[] };
  },

  validate(rawRows: Record<string, unknown>[]) {
    return validateVerificationRows(rawRows as unknown as Record<string, string>[]);
  },

  normalise(valid: unknown[]) {
    const result = normaliseVerification(valid as Parameters<typeof normaliseVerification>[0]);
    return {
      rows: result.rows as unknown as Record<string, unknown>[],
      excludedPreWindow: result.excludedPreWindow,
    };
  },

  async upsert(deps: IngestDeps, rows: Record<string, unknown>[]) {
    return deps.upsertVerifications(rows as unknown as Parameters<typeof deps.upsertVerifications>[0]);
  },
};
