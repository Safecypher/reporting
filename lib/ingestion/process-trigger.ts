/**
 * RED stub (13-05 Task 1). Real implementation lands in the GREEN commit.
 * Throws rather than being absent, so the new suite fails on real
 * assertions instead of a module-not-found error (13-03's precedent for a
 * brand-new file under lib/ingestion/).
 */
export const INGEST_PROCESS_FUNCTION_PATH = "/.netlify/functions/ingest-process-background";

export function verifyIngestProcessSecret(): never {
  throw new Error("verifyIngestProcessSecret: not implemented yet");
}

export async function triggerBackgroundProcessing(): Promise<never> {
  throw new Error("triggerBackgroundProcessing: not implemented yet");
}
