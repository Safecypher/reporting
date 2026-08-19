import { createHash } from "node:crypto";

/**
 * Deterministic sha256 of raw file bytes, used for duplicate-file detection
 * (INGEST-05) — `ingest()` checks `IngestDeps.findFileByHash` before parsing
 * so an identical re-upload short-circuits without touching the DB rows.
 *
 * Node runtime only (`node:crypto` is not Edge-safe).
 */
export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
