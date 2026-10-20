/**
 * XLSX size cap (D-16). Deliberately ZERO imports: a client component
 * (the upload dialog, 14-04) imports these two constants to refuse an
 * oversized spreadsheet before upload, so this module must not pull in any
 * server-only dependency.
 *
 * Why 15 MiB: ExcelJS loads the whole workbook into memory. Measured in
 * 14-RESEARCH.md, a 17 MB workbook reached 1.25 GB RSS against a 1024 MB
 * function, so XLSX cannot be treated like CSV (which is read in bounded
 * windows). The only XLSX report type is the TSYS "Safecypher Stats"
 * workbook, which is far below this today.
 *
 * Revisit trigger: a TSYS Stats file nearing 8 MB. At that point the cap
 * has stopped being headroom and the XLSX path needs a streaming reader.
 */
export const MAX_XLSX_BYTES = 15 * 1024 * 1024;

/** The single user-facing reason recorded when an XLSX exceeds MAX_XLSX_BYTES. */
export const XLSX_TOO_LARGE_REASON =
  "XLSX file larger than 15 MB — not processed (spreadsheet size limit)";
