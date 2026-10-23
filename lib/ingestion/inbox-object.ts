/**
 * The shared per-object ingest step for the `inbox` bucket, plus the codec for
 * the FLAT key a manual upload lands under (Phase 14, D-08 / D-17).
 *
 * Two callers need the same step: the claim route (one manual upload, run
 * immediately) and, from 14-05, the drain (every leftover object, push or
 * manual). One function serves both so provenance, writer lifetime and trigger
 * handling cannot drift between them. The push branch is a verbatim extraction
 * of the drain route's former private `ingestOne` closure.
 *
 * Relative imports only (no "@/" alias, no Next.js module specifier): this
 * module sits beside process-trigger.ts and pending-runner.ts, which the
 * hand-authored Netlify background function bundles, and that bundler resolves
 * neither.
 */
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/db";
import { claimFile } from "./index";
import { createSupabaseWriter, sanitiseFileName } from "./supabase-writer";
import type { TriggerBackgroundProcessingResult } from "./process-trigger";
import type { IngestDeps, IngestionResult, ReportType } from "./types";

/** The private Storage bucket push deliveries and manual uploads both land in. */
export const INBOX_BUCKET = "inbox";

/** The key prefix that marks a manual upload; anything else is a push delivery. */
export const MANUAL_PREFIX = "manual";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One anchored regex for the whole key. The name group is exactly the
 * alphabet `sanitiseFileName` emits (letters, digits, dot, underscore,
 * hyphen), so a second slash, a `..` segment or any other shape cannot match.
 */
const MANUAL_KEY_RE =
  /^manual\/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})-([0-9a-f]{16})-([A-Za-z0-9._-]{1,200})$/;

export interface ParsedManualObjectKey {
  /** ISO-8601 instant the key was minted, with colons and a trailing Z. */
  mintedAt: string;
  /** The uploader's auth user id, lower-cased. */
  userId: string;
  nonce: string;
  /** The sanitised file name as it sits in the key. */
  fileName: string;
}

/**
 * Builds the FLAT inbox key `manual/{basic-ISO-ts}-{userId}-{nonce}-{name}`
 * (D-17). Flat on purpose: the drain lists exactly two levels, so a nested
 * `manual/{userId}/...` object would be silently invisible to it and break D-09.
 *
 * The timestamp is the exact basic-ISO form `lib/push/delivery.ts`'s
 * `buildObjectKey` writes, so the drain's `parseDeliveredAt` reads it
 * unchanged. The nonce makes the path unguessable, so a signed upload token
 * (stateless, replayable for its two hours) is only ever useful for the one
 * path it was minted for.
 */
export function buildManualObjectKey(
  userId: string,
  fileName: string,
  now: Date = new Date(),
  nonce: string = randomBytes(8).toString("hex")
): string {
  if (!UUID_RE.test(userId)) {
    // Defensive: a session user id is always a UUID, and the key embeds it as
    // the attribution the claim authorises against.
    throw new Error("buildManualObjectKey: userId must be a UUID");
  }
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${MANUAL_PREFIX}/${timestamp}-${userId.toLowerCase()}-${nonce}-${sanitiseFileName(fileName)}`;
}

/** The inverse of `buildManualObjectKey`; null for any other shape. */
export function parseManualObjectKey(key: string): ParsedManualObjectKey | null {
  const match = MANUAL_KEY_RE.exec(key);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, userId, nonce, fileName] = match;
  return {
    mintedAt: `${y}-${mo}-${d}T${h}:${mi}:${s}Z`,
    userId: userId.toLowerCase(),
    nonce,
    fileName,
  };
}

/**
 * The human-readable name for the ingested_files row. The browser may supply
 * the original name (spaces and all), but only when it sanitises to the name
 * the server minted into the key — a claim body cannot relabel another file.
 */
export function resolveManualDisplayName(parsed: ParsedManualObjectKey, suppliedName?: string): string {
  if (suppliedName !== undefined && sanitiseFileName(suppliedName) === parsed.fileName) {
    return suppliedName;
  }
  return parsed.fileName;
}

/**
 * A manual object younger than this is left alone by the drain (D-17, T-14-21):
 * the claim that follows an upload runs within seconds, so anything this old
 * was abandoned, and anything younger may still be being claimed.
 */
export const MANUAL_INBOX_GRACE_MINUTES = 15;

/**
 * The most manual bytes one drain run will take (T-14-22). A literal rather
 * than an import of `MAX_UPLOAD_BYTES`, because claim-upload.ts imports this
 * module and the reverse import would be a runtime cycle; a test pins the two
 * equal. The unit is the claim's own ceiling, so a run always has room for at
 * least one maximum-size object and never for a backlog that would push the
 * evidence row and Slack alert past the request's measured ~30 s ceiling.
 * 52,428,800 bytes (50 MiB) under D-20, which supersedes D-04's 100 MiB.
 */
export const MANUAL_DRAIN_BYTE_BUDGET = 52_428_800;

/** The slice of a Storage `list()` entry the drain's selection reads. */
export interface InboxListEntry {
  name: string;
  created_at: string | null;
  /** Null for a folder pseudo-entry; an object for a real file. */
  metadata: { size?: number } | null;
}

export interface DrainableSelection {
  names: string[];
  deferred: { name: string; reason: "young" | "budget" | "oversize" }[];
}

/**
 * Decides which listed names under one inbox prefix the drain may take this run.
 *
 * Every prefix: folder entries (null metadata) and any name starting with a dot
 * (the dashboard's `.emptyFolderPlaceholder`) are dropped, never deferred -- they
 * are not uploads.
 *
 * A push prefix returns everything else untouched, exactly as before Phase 14.
 *
 * The manual prefix is taken oldest first (the flat key starts with its mint
 * timestamp, so name order is time order), skipping what is still inside the
 * grace window and stopping at the per-run byte budget. The budget is strict
 * oldest-first: once an entry does not fit, every later one waits too, so a
 * large old object cannot be starved by smaller newer ones. The first eligible
 * entry is always taken, so an object of exactly the budget still moves.
 * Deferral is not failure: deferred names stay in the inbox and the next run
 * (and /uploads) sees them.
 */
export function selectDrainableInboxNames(prefix: string, entries: InboxListEntry[], asOf: Date): DrainableSelection {
  const real = entries.filter((entry) => entry.metadata !== null && !entry.name.startsWith("."));
  if (prefix !== MANUAL_PREFIX) {
    return { names: real.map((entry) => entry.name), deferred: [] };
  }

  const names: string[] = [];
  const deferred: DrainableSelection["deferred"] = [];
  const graceMs = MANUAL_INBOX_GRACE_MINUTES * 60_000;
  let budgetSpent = 0;
  let budgetClosed = false;

  for (const entry of [...real].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const createdMs = entry.created_at ? Date.parse(entry.created_at) : NaN;
    const mintedAt = parseManualObjectKey(`${MANUAL_PREFIX}/${entry.name}`)?.mintedAt;
    const receivedMs = Number.isNaN(createdMs) ? (mintedAt ? Date.parse(mintedAt) : NaN) : createdMs;
    // No usable timestamp at all: treat as old. Deferring forever would hide an
    // object nothing else can place in time; the claim never leaves one.
    if (!Number.isNaN(receivedMs) && asOf.getTime() - receivedMs < graceMs) {
      deferred.push({ name: entry.name, reason: "young" });
      continue;
    }

    const size = entry.metadata?.size ?? 0;
    if (size > MANUAL_DRAIN_BYTE_BUDGET) {
      deferred.push({ name: entry.name, reason: "oversize" });
      continue;
    }
    if (budgetClosed || (names.length > 0 && budgetSpent + size > MANUAL_DRAIN_BYTE_BUDGET)) {
      budgetClosed = true;
      deferred.push({ name: entry.name, reason: "budget" });
      continue;
    }
    names.push(entry.name);
    budgetSpent += size;
  }

  return { names, deferred };
}

export type InboxObjectOutcome =
  | { kind: "terminal"; result: IngestionResult }
  | { kind: "pending"; ingestedFileId: string; reportType: ReportType };

export interface IngestInboxObjectDeps {
  supabase: SupabaseClient<Database>;
  /** Fires the Phase 13 background function for a claimed file. Must not throw. */
  trigger(fileId: string): Promise<TriggerBackgroundProcessingResult>;
  /** Log prefix for a trigger that did not fire; defaults to "[ingest]". */
  logLabel?: string;
}

/**
 * Claims one inbox object (hash, classify, record) and fires the background
 * trigger. Branches on the key alone: `manual/...` is a manual upload,
 * anything else keeps the push provenance exactly as the drain always wrote it.
 *
 * A new writer is constructed per call and never reused: the writer carries
 * per-file closure state (the recorded row id), so sharing one across objects
 * would cross-wire file ids and provenance (09-RESEARCH.md Pitfall 4).
 */
export async function ingestInboxObject(
  input: { key: string; bytes: Uint8Array; fileNameOverride?: string },
  deps: IngestInboxObjectDeps
): Promise<InboxObjectOutcome> {
  const { key, bytes } = input;
  const isManual = key.startsWith(`${MANUAL_PREFIX}/`);

  let writer: IngestDeps;
  let fileName: string;
  let uploadedBy: string | null;

  if (isManual) {
    // Today's manual provenance: source 'manual', null source_ref and
    // credential. The uploader comes from the minted key, never from a body.
    const parsed = parseManualObjectKey(key);
    writer = createSupabaseWriter(deps.supabase);
    uploadedBy = parsed?.userId ?? null;
    fileName = input.fileNameOverride ?? parsed?.fileName ?? key.split("/").pop() ?? key;
  } else {
    const leadingSegment = key.split("/")[0];
    const sourceCredentialId = UUID_RE.test(leadingSegment) ? leadingSegment : undefined;
    writer = createSupabaseWriter(deps.supabase, {
      source: "push",
      sourceRef: key,
      sourceCredentialId,
    });
    uploadedBy = null;
    fileName = key.split("/").pop() ?? key;
  }

  const claimResult = await claimFile({ fileName, bytes, contentType: undefined, uploadedBy }, writer);

  if (claimResult.kind !== "claimed") {
    // Already-uploaded / unrecognised: terminal inside claimFile; nothing is
    // left to process, so no trigger is fired.
    return { kind: "terminal", result: claimResult.result };
  }

  // A failed or not-configured trigger must never fail the caller: the row is
  // already correctly pending and the sweep is the backstop (Phase 13 D-08).
  // Logs the file id and the (already-redacted) outcome only, never the secret.
  const triggerResult = await deps.trigger(claimResult.claim.ingestedFileId);
  if (triggerResult.outcome !== "fired") {
    console.error(
      `${deps.logLabel ?? "[ingest]"} background trigger did not fire`,
      claimResult.claim.ingestedFileId,
      triggerResult.outcome,
      triggerResult.outcome === "failed" ? triggerResult.message : undefined
    );
  }

  return {
    kind: "pending",
    ingestedFileId: claimResult.claim.ingestedFileId,
    reportType: claimResult.claim.reportType,
  };
}
