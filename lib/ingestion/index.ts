import { classify } from "./classify";
import { sha256 } from "./hash";
import { normaliseVerification } from "./normalise";
import { parseVerification, validateVerificationRows } from "./parsers/verification";
import type { IngestDeps, IngestionInput, IngestionResult, RejectedRow } from "./types";

/**
 * The single shared ingestion entry point (INGEST-03). Every source
 * (manual drag-and-drop today, an automated file-drop/webhook adapter
 * later) constructs an `IngestionInput` and calls this function — no
 * parsing, validation, normalisation, or DB-write logic lives anywhere
 * else. The DB writer is injected via `deps` so this module never imports
 * a Supabase client and stays pure/unit-testable.
 */
export async function ingest(input: IngestionInput, deps: IngestDeps): Promise<IngestionResult> {
  const contentSha256 = sha256(input.bytes);

  const existing = await deps.findFileByHash(contentSha256);
  if (existing) {
    return {
      reportType: null,
      accepted: 0,
      duplicates: 0,
      rejected: 0,
      rejectReasons: [],
      ingestedFileId: existing.id,
      alreadyUploaded: { date: existing.uploaded_at },
    };
  }

  // Classification needs a header row; parse defensively — a completely
  // unparsable/empty file still classifies to null rather than throwing.
  let headerRow: string[] = [];
  try {
    headerRow = parseVerification(input.bytes).headerRow;
  } catch {
    headerRow = [];
  }
  const reportType = classify(input.fileName, headerRow);

  if (reportType === null) {
    const ingestedFileId = await deps.recordFile({
      fileName: input.fileName,
      contentSha256,
      uploadedBy: input.uploadedBy,
      reportType: null,
      bytes: input.bytes,
    });
    const rejectReasons: RejectedRow[] = [{ row: 0, reasons: ["unrecognised report type"] }];
    await deps.finalizeFile(ingestedFileId, { accepted: 0, duplicates: 0, rejected: 0, rejectReasons });
    return {
      reportType: null,
      accepted: 0,
      duplicates: 0,
      rejected: 0,
      rejectReasons,
      ingestedFileId,
    };
  }

  const ingestedFileId = await deps.recordFile({
    fileName: input.fileName,
    contentSha256,
    uploadedBy: input.uploadedBy,
    reportType,
    bytes: input.bytes,
  });

  const { rows } = parseVerification(input.bytes);
  const { valid, rejected } = validateVerificationRows(rows);
  const normalised = normaliseVerification(valid);

  const inserted = await deps.upsertVerifications(normalised);
  const duplicates = normalised.length - inserted;

  const counts = {
    accepted: inserted,
    duplicates,
    rejected: rejected.length,
    rejectReasons: rejected,
  };
  await deps.finalizeFile(ingestedFileId, counts);

  return {
    reportType,
    accepted: inserted,
    duplicates,
    rejected: rejected.length,
    rejectReasons: rejected,
    ingestedFileId,
  };
}
