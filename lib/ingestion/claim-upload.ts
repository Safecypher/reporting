/**
 * The pure core of the manual-upload claim step (Phase 14, D-02 / D-14 / D-15).
 *
 * After the browser has PUT a file into the inbox through a signed URL, the
 * claim route calls `claimManualUpload`: authorise the key against the session,
 * measure the real size, read the bytes back, hand them to the shared
 * per-object step, then remove the inbox object. The order of those steps is
 * the safety argument, so it lives in this one function with every Storage and
 * ingest effect injected — nothing here touches Supabase, so each branch is
 * testable with plain fakes (the `acceptPush` / `drainInbox` pattern).
 *
 * Nothing the browser says about the file is used for a decision: size comes
 * from Storage metadata and then the downloaded byte length, type is sniffed
 * from the bytes inside `claimFile`, and the hash is computed there too. The
 * browser-supplied file name only ever resolves a display name bound to the
 * minted key.
 *
 * Relative imports only, for the same bundler reason as inbox-object.ts.
 */
import type { IngestionResult, ReportType } from "./types";
import {
  parseManualObjectKey,
  resolveManualDisplayName,
  type InboxObjectOutcome,
} from "./inbox-object";

/**
 * The transfer ceiling: 50 MiB (52,428,800 bytes) per file. This is the
 * Supabase Free plan's per-object cap, and the project stays on Free (D-20,
 * which supersedes D-04's 100 MiB). Raising it after a Pro upgrade is four
 * edits that must move together: this constant, MANUAL_DRAIN_BYTE_BUDGET in
 * inbox-object.ts, FILE_TOO_LARGE_MESSAGE in lib/upload/batch.ts and the
 * inbox bucket's file_size_limit.
 */
export const MAX_UPLOAD_BYTES = 52_428_800;

export interface ClaimUploadDeps {
  /** Storage metadata size for the object; `found: false` when it does not exist (already claimed, or never uploaded). */
  getObjectSize(key: string): Promise<{ found: false } | { found: true; size: number | null }>;
  download(key: string): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
  /** The shared per-object step bound to the secret client and the background trigger. */
  ingestOne(key: string, bytes: Uint8Array, fileName: string): Promise<InboxObjectOutcome>;
  /** Millisecond clock; defaults to `Date.now`. Injected so timings are deterministic under test. */
  now?(): number;
}

export type ClaimUploadOutcome =
  | { kind: "not-found"; timings: Record<string, number> }
  | { kind: "too-large"; timings: Record<string, number> }
  | { kind: "terminal"; result: IngestionResult; timings: Record<string, number> }
  | { kind: "pending"; ingestedFileId: string; reportType: ReportType; timings: Record<string, number> }
  | { kind: "received"; timings: Record<string, number> };

/** Best-effort removal: a failure is logged and never changes the verdict. */
async function removeQuietly(deps: ClaimUploadDeps, key: string): Promise<void> {
  try {
    await deps.remove(key);
  } catch (error) {
    // A leftover object is harmless: the drain re-ingests it and content-hash
    // dedup reports it as already uploaded.
    console.error("[claim] could not remove inbox object", error instanceof Error ? error.message : String(error));
  }
}

export async function claimManualUpload(
  input: { key: string; sessionUserId: string; fileName?: string },
  deps: ClaimUploadDeps
): Promise<ClaimUploadOutcome> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const timings: Record<string, number> = {};
  const finish = (): Record<string, number> => ({ ...timings, totalMs: now() - startedAt });

  // (1) Authorise the key BEFORE any Storage call. A malformed key and a key
  // minted for another user answer exactly like a missing object, so a caller
  // cannot probe for other users' uploads.
  const parsed = parseManualObjectKey(input.key);
  if (!parsed || parsed.userId !== input.sessionUserId.toLowerCase()) {
    return { kind: "not-found", timings: finish() };
  }

  let outcome: InboxObjectOutcome;
  try {
    // (2) Existence and real size from Storage's own metadata.
    const sizeStartedAt = now();
    const info = await deps.getObjectSize(input.key);
    timings.sizeMs = now() - sizeStartedAt;
    if (!info.found) {
      // The double-claim case: the object is already gone.
      return { kind: "not-found", timings: finish() };
    }
    // First size guard (P14-03, D-04): refuse before downloading a byte. A
    // null size means Storage gave no metadata; the second guard covers it.
    if (info.size !== null && info.size > MAX_UPLOAD_BYTES) {
      await removeQuietly(deps, input.key);
      return { kind: "too-large", timings: finish() };
    }

    // (3) Read the bytes back, then check the real byte length: metadata can
    // be absent, and this is the measurement the parser is about to trust.
    const downloadStartedAt = now();
    const bytes = await deps.download(input.key);
    timings.downloadMs = now() - downloadStartedAt;
    timings.bytes = bytes.length;
    // Second size guard: before any parsing, on the bytes actually received.
    if (bytes.length > MAX_UPLOAD_BYTES) {
      await removeQuietly(deps, input.key);
      return { kind: "too-large", timings: finish() };
    }

    // (4) The shared per-object step: hash, classify, record, trigger.
    const ingestStartedAt = now();
    outcome = await deps.ingestOne(input.key, bytes, resolveManualDisplayName(parsed, input.fileName));
    timings.ingestMs = now() - ingestStartedAt;
  } catch (error) {
    // D-15: the bytes already reached the inbox, so the system holds the file.
    // Leave the object in place for the drain or a retry and never report a
    // held file as failed.
    console.error("[claim] claim step failed; leaving the inbox object", error instanceof Error ? error.message : String(error));
    return { kind: "received", timings: finish() };
  }

  // (5) Every terminal outcome removes the inbox object (D-14): an
  // unrecognised file's bytes survive in `reports` because recordFile wrote
  // them, and a duplicate is deliberately not stored again.
  const removeStartedAt = now();
  await removeQuietly(deps, input.key);
  timings.removeMs = now() - removeStartedAt;

  // (6) Map to the verdict.
  if (outcome.kind === "terminal") {
    return { kind: "terminal", result: outcome.result, timings: finish() };
  }
  return {
    kind: "pending",
    ingestedFileId: outcome.ingestedFileId,
    reportType: outcome.reportType,
    timings: finish(),
  };
}

/**
 * The HTTP shape of each outcome. Terminal and pending bodies are today's
 * `/api/ingest` bodies unchanged (P14-04), so the dropzone's existing
 * handling keeps working.
 */
export function claimOutcomeToResponse(outcome: ClaimUploadOutcome): { status: number; body: unknown } {
  switch (outcome.kind) {
    case "not-found":
      return { status: 404, body: { error: "Upload not found" } };
    case "too-large":
      return { status: 413, body: { error: "File too large" } };
    case "terminal":
      return { status: 200, body: outcome.result };
    case "pending":
      return {
        status: 202,
        body: { fileId: outcome.ingestedFileId, reportType: outcome.reportType, status: "pending" },
      };
    case "received":
      return { status: 202, body: { status: "received" } };
  }
}
