import { REPORT_HANDLERS } from "./index";
import type { ReportType } from "./types";

/** Strip a leading UTF-8 BOM character from a header cell (Pitfall 4, D-12). */
export function stripBom(value: string): string {
  return value.replace(/^﻿/, "");
}

/**
 * BOM-strip the first cell of `headerRow`, then compare length + exact
 * column order against `expected` (D-11). Shared by every CSV handler's
 * `classify()` so the either-suffices filename-OR-header matching logic
 * stays consistent across all six report types.
 */
export function matchesHeader(headerRow: string[], expected: readonly string[]): boolean {
  const normalised = headerRow.map((h, i) => (i === 0 ? stripBom(h) : h));
  return normalised.length === expected.length && expected.every((col, i) => normalised[i] === col);
}

/**
 * Compatibility wrapper (CSV-only) around the `REPORT_HANDLERS` registry
 * (lib/ingestion/index.ts) — kept so the original Phase 1 classify test
 * keeps passing unchanged. `ingest()` itself no longer calls this; it
 * dispatches through `REPORT_HANDLERS` directly using the richer
 * `HeaderSignature` (CSV-or-XLSX) produced by `extractHeaderSignature`.
 *
 * Imports `REPORT_HANDLERS` from `./index` — a one-directional dependency
 * (classify.ts -> index.ts). `index.ts` does not import from this module,
 * so there is no import cycle.
 */
export function classify(fileName: string, headerRow: string[]): ReportType | null {
  const signature = { kind: "csv" as const, headerRow };
  const handler = REPORT_HANDLERS.find((h) => {
    try {
      return h.classify(fileName, signature);
    } catch {
      return false;
    }
  });

  return handler ? handler.reportType : null;
}
