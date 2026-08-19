import type { ReportType } from "./types";

/** The five columns the verification report must have, in order, once any BOM is stripped. */
const VERIFICATION_HEADER_SIGNATURE = [
  "CreatedAt",
  "ExternalCardReference",
  "Cvi2Value",
  "duration",
  "Authenticated",
] as const;

/** Strip a leading UTF-8 BOM character from a header cell (Pitfall 4). */
function stripBom(value: string): string {
  return value.replace(/^﻿/, "");
}

/**
 * Classify an uploaded file as a known `ReportType`, or `null` if
 * unrecognised (INGEST-02). Only the verification report is wired in
 * Phase 1; Phase 2 extends this with the other five report signatures.
 *
 * Matches by filename substring `daily-ver` OR by an exact header
 * signature — either signal alone is sufficient, so a header-only match
 * (e.g. a re-named file) still classifies correctly.
 */
export function classify(fileName: string, headerRow: string[]): ReportType | null {
  const normalisedHeader = headerRow.map((h, i) => (i === 0 ? stripBom(h) : h));

  const filenameMatches = fileName.toLowerCase().includes("daily-ver");
  const headerMatches =
    normalisedHeader.length === VERIFICATION_HEADER_SIGNATURE.length &&
    VERIFICATION_HEADER_SIGNATURE.every((col, i) => normalisedHeader[i] === col);

  if (filenameMatches || headerMatches) {
    return "verification";
  }

  return null;
}
