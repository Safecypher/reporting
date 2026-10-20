/**
 * Storage-first transfer decision tree for one manual upload (D-01, D-13,
 * D-15): mint a signed upload URL, PUT the bytes to Storage, claim the
 * object. Pure by construction: every network or browser effect arrives as an
 * injected dependency, so the behaviour below is exactly what the unit tests
 * prove. `deps.put` is the `putToStorage` seam the research names: a TUS
 * (resumable) transfer could replace it without touching the dropzone loop
 * (D-07 contingency).
 *
 * Total function: it always resolves to a `BatchFileOutcome` and never
 * rejects, which is what makes the batch's continue-on-failure behaviour
 * structural.
 *
 * The rules, in the order the user set them:
 *  - D-13: a transfer that fails is retried exactly once with a FRESH signed
 *    URL (a new mint, a new key); a second failure is "Upload interrupted".
 *  - D-15: once a PUT has succeeded the system holds the bytes, so every
 *    claim problem (network error, 5xx, 504, 401, 404, an unparsable body, or
 *    a 202 "received") is reported as received, never as a failure. The one
 *    exception is 413, which is a verdict about the file, not an outage.
 */
import {
  FILE_TOO_LARGE_MESSAGE,
  RECEIVED_MESSAGE,
  UPLOAD_FAILED_MESSAGE,
  UPLOAD_INTERRUPTED_MESSAGE,
  describeIngestFailure,
  type BatchFileOutcome,
} from "@/lib/upload/batch";
import type { IngestionResult, ReportType } from "@/lib/ingestion/types";

export type MintResult = { ok: true; path: string; token: string } | { ok: false; status: number };

export type ClaimResponse = { status: number; body: unknown };

export interface TransferDeps {
  fileName: string;
  mint(): Promise<MintResult>;
  put(path: string, token: string): Promise<boolean>;
  claim(path: string): Promise<ClaimResponse>;
  onStage?(stage: "uploading" | "checking"): void;
}

const MAX_ATTEMPTS = 2;

function signal(deps: TransferDeps, stage: "uploading" | "checking"): void {
  try {
    deps.onStage?.(stage);
  } catch {
    // A rendering problem must never change what happens to the file.
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function mapClaim(fileName: string, response: ClaimResponse): BatchFileOutcome {
  const { status, body } = response;

  if (status === 413) {
    return { fileName, kind: "failed", message: FILE_TOO_LARGE_MESSAGE };
  }

  if (status === 200 && isObject(body)) {
    return { fileName, kind: "result", result: body as unknown as IngestionResult };
  }

  if (
    status === 202 &&
    isObject(body) &&
    body.status === "pending" &&
    typeof body.fileId === "string"
  ) {
    return {
      fileName,
      kind: "pending",
      fileId: body.fileId,
      reportType: body.reportType as ReportType,
    };
  }

  return { fileName, kind: "received", message: RECEIVED_MESSAGE };
}

export async function uploadViaStorage(deps: TransferDeps): Promise<BatchFileOutcome> {
  const { fileName } = deps;
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const isRetry = attempt > 1;
      signal(deps, "uploading");

      let minted: MintResult;
      try {
        minted = await deps.mint();
      } catch {
        return {
          fileName,
          kind: "failed",
          message: isRetry ? UPLOAD_INTERRUPTED_MESSAGE : UPLOAD_FAILED_MESSAGE,
        };
      }

      if (!minted.ok) {
        const message =
          isRetry && minted.status !== 401 && minted.status !== 413
            ? UPLOAD_INTERRUPTED_MESSAGE
            : describeIngestFailure(minted.status);
        return { fileName, kind: "failed", message };
      }

      let stored = false;
      try {
        stored = await deps.put(minted.path, minted.token);
      } catch {
        stored = false;
      }

      if (!stored) {
        if (isRetry) {
          return { fileName, kind: "failed", message: UPLOAD_INTERRUPTED_MESSAGE };
        }
        continue;
      }

      signal(deps, "checking");
      try {
        return mapClaim(fileName, await deps.claim(minted.path));
      } catch {
        return { fileName, kind: "received", message: RECEIVED_MESSAGE };
      }
    }

    return { fileName, kind: "failed", message: UPLOAD_INTERRUPTED_MESSAGE };
  } catch {
    return { fileName, kind: "failed", message: UPLOAD_FAILED_MESSAGE };
  }
}
