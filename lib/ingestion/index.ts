import Papa from "papaparse";
import { apigeeStatsHandler } from "./handlers/apigee-stats";
import { billingHandler } from "./handlers/billing";
import { cardInventoryHandler } from "./handlers/card-inventory";
import { dcvvHandler } from "./handlers/dcvv";
import { removedCardsHandler } from "./handlers/removed-cards";
import { verificationHandler } from "./handlers/verification";
import { sha256 } from "./hash";
import type {
  HeaderSignature,
  IngestDeps,
  IngestionInput,
  IngestionResult,
  ReportHandler,
  RejectedRow,
} from "./types";

/**
 * The registry every report type plugs into (RESEARCH.md Pattern 1).
 * Verification is one handler among six — its behaviour and DB-write path
 * are unchanged from Phase 1. The five new handlers are stubs (real
 * classification, `parse()` throws "not implemented yet") ready for their
 * Wave 2 slices to overwrite; no shared file needs editing to add a report
 * type once its handler module exists.
 */
export const REPORT_HANDLERS: ReportHandler[] = [
  verificationHandler,
  billingHandler,
  dcvvHandler,
  cardInventoryHandler,
  removedCardsHandler,
  apigeeStatsHandler,
];

/** ZIP magic number — XLSX is a ZIP container; CSV/text never starts with this (T-02-01). */
function isXlsx(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/**
 * Format-aware classification signature extraction (RESEARCH.md Pattern 2).
 * Detects XLSX by the ZIP magic bytes on the buffer itself — NEVER by the
 * client-supplied `contentType` (T-02-01, Pitfall 3) — and returns either a
 * CSV header row or an XLSX sheet-name list + header row. Wrapped by the
 * caller in the same defensive try/catch pattern as the rest of `ingest()`
 * (T-02-02): a crafted/corrupt file must classify to `null`, never throw
 * unguarded.
 */
async function extractHeaderSignature(
  bytes: Uint8Array,
  _fileName: string
): Promise<HeaderSignature> {
  if (isXlsx(bytes)) {
    // Lazily imported so CSV-only code paths never pull in ExcelJS.
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    // Cast through `unknown`: exceljs's transitive dep `fast-csv` ships its
    // own nested `@types/node@14` whose `Buffer` type lacks fields added in
    // later Node type defs (`maxByteLength` etc.), so the ambient `Buffer`
    // TS resolves at this call site can mismatch the one `Buffer.from`
    // produces here — a duplicate-@types/node artifact, not a real type
    // error (the runtime value is a standard Node Buffer either way).
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheetNames = workbook.worksheets.map((w) => w.name);
    // CR-02: capture the row-1 header for EVERY sheet, keyed by sheet name, so
    // a handler can match the header of the sheet it names regardless of tab
    // order. Reading only worksheets[0] silently misclassified the whole
    // apigee-stats source whenever "APIGEE Calls" was not the first tab.
    const headerRowsBySheet: Record<string, string[]> = {};
    for (const sheet of workbook.worksheets) {
      const header: string[] = [];
      sheet.getRow(1).eachCell({ includeEmpty: false }, (cell) => {
        header.push(String(cell.value ?? ""));
      });
      headerRowsBySheet[sheet.name] = header;
    }
    return { kind: "xlsx", sheetNames, headerRowsBySheet };
  }

  const text = new TextDecoder("utf-8").decode(bytes);
  const parsed = Papa.parse<Record<string, string>>(text, { header: true });
  return { kind: "csv", headerRow: parsed.meta.fields ?? [] };
}

/**
 * The single shared ingestion entry point (INGEST-03). Every source
 * (manual drag-and-drop today, an automated file-drop/webhook adapter
 * later) constructs an `IngestionInput` and calls this function — no
 * parsing, validation, normalisation, or DB-write logic lives anywhere
 * else. The DB writer is injected via `deps` so this module never imports
 * a Supabase client and stays pure/unit-testable.
 *
 * Invariant (CR-02): every parsed row is accounted for —
 *   accepted + duplicates + rejected + excluded === total parsed rows.
 * Nothing is ever silently dropped. `excluded` = valid rows removed by the
 * DATA-06 data-window cutoff; `rejected` = malformed rows (with reasons).
 */
export async function ingest(input: IngestionInput, deps: IngestDeps): Promise<IngestionResult> {
  const contentSha256 = sha256(input.bytes);

  const existing = await deps.findFileByHash(contentSha256);
  if (existing) {
    return {
      // Report the real recorded type, not null (IN-02).
      reportType: existing.report_type,
      accepted: 0,
      duplicates: 0,
      rejected: 0,
      excluded: 0,
      rejectReasons: [],
      ingestedFileId: existing.id,
      alreadyUploaded: { date: existing.uploaded_at },
    };
  }

  // Classification needs a header/sheet signature; extract defensively — a
  // completely unparsable/empty/corrupt file still classifies to null
  // rather than throwing (T-02-02).
  let signature: HeaderSignature = { kind: "csv", headerRow: [] };
  try {
    signature = await extractHeaderSignature(input.bytes, input.fileName);
  } catch {
    signature = { kind: "csv", headerRow: [] };
  }

  const handler = REPORT_HANDLERS.find((h) => {
    try {
      return h.classify(input.fileName, signature);
    } catch {
      return false;
    }
  });

  if (!handler) {
    const ingestedFileId = await deps.recordFile({
      fileName: input.fileName,
      contentSha256,
      uploadedBy: input.uploadedBy,
      reportType: null,
      bytes: input.bytes,
    });
    const rejectReasons: RejectedRow[] = [{ row: 0, reasons: ["unrecognised report type"] }];
    await deps.finalizeFile(ingestedFileId, {
      accepted: 0,
      duplicates: 0,
      rejected: 0,
      excluded: 0,
      rejectReasons,
      status: "failed",
    });
    return {
      reportType: null,
      accepted: 0,
      duplicates: 0,
      rejected: 0,
      excluded: 0,
      rejectReasons,
      ingestedFileId,
    };
  }

  const reportType = handler.reportType;

  const ingestedFileId = await deps.recordFile({
    fileName: input.fileName,
    contentSha256,
    uploadedBy: input.uploadedBy,
    reportType,
    bytes: input.bytes,
  });

  // CR-01: classify() can match on filename alone, so the file may still be
  // unparsable here (missing columns, corrupt, not-yet-implemented parser).
  // Guard this parse — an unguarded throw would leave the audit row stuck at
  // 'pending' forever AND make every future re-upload falsely short-circuit
  // as "already uploaded".
  let rawRows: Record<string, unknown>[];
  try {
    rawRows = (await handler.parse(input.bytes, input.fileName)).rawRows;
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unparsable file";
    const rejectReasons: RejectedRow[] = [{ row: 0, reasons: [reason] }];
    await deps.finalizeFile(ingestedFileId, {
      accepted: 0,
      duplicates: 0,
      rejected: 0,
      excluded: 0,
      rejectReasons,
      status: "failed",
    });
    return {
      reportType,
      accepted: 0,
      duplicates: 0,
      rejected: 0,
      excluded: 0,
      rejectReasons,
      ingestedFileId,
    };
  }

  const { valid, rejected } = handler.validate(rawRows);
  const { rows: normalised, excludedPreWindow } = handler.normalise(valid);

  const inserted = await handler.upsert(deps, normalised);
  const duplicates = normalised.length - inserted;

  const counts = {
    accepted: inserted,
    duplicates,
    rejected: rejected.length,
    excluded: excludedPreWindow,
    rejectReasons: rejected,
    status: "done" as const,
  };
  await deps.finalizeFile(ingestedFileId, counts);

  return {
    reportType,
    accepted: inserted,
    duplicates,
    rejected: rejected.length,
    excluded: excludedPreWindow,
    rejectReasons: rejected,
    ingestedFileId,
  };
}
