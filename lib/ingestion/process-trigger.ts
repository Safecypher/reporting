/**
 * Netlify background-function invocation path, shared-secret verifier and
 * trigger (13-05, D-07/D-08).
 *
 * Deliberately pure: no `process.env` access and no clock access of its
 * own, mirroring `pending-state.ts`'s discipline — every case is testable
 * with no network and no Netlify. The call site (`/api/ingest`'s POST
 * handler, and the drain route's sweep in 13-07) reads
 * `NEXT_PUBLIC_SITE_URL`/`INGEST_PROCESS_SECRET` from the environment and
 * passes them in explicitly as injected dependencies.
 *
 * Relative import only — this module is imported by the hand-authored
 * Netlify background function, whose bundler resolves neither Next.js
 * module specifiers nor this project's "@/" tsconfig alias (13-RESEARCH.md
 * "Runtime and Bundling"), exactly the same constraint `lib/ingestion/`
 * already holds itself to (13-03).
 */
import { timingSafeEqual } from "node:crypto";
import { hashToken } from "../push/tokens";

/**
 * The background function's invocation path — under Netlify's reserved
 * `/.netlify/functions/` prefix. ONE definition, read by this constant and
 * by the function's own file name
 * (`netlify/functions/ingest-process-background.mts`): a POST to a path
 * that does not route to a background-configured function returns 202 and
 * silently never executes — documented community experience with this
 * exact platform (13-RESEARCH.md "Local development", the
 * `nextjs-background-functions-return-202-but-never-actually-run` thread).
 * A rename here without the matching function file rename is caught by
 * this plan's own `<verify>` gate, not remembered.
 */
export const INGEST_PROCESS_FUNCTION_PATH = "/.netlify/functions/ingest-process-background";

/**
 * Short — the invocation only needs to be acknowledged, not completed.
 * Netlify's own 202 is returned the instant the function is invoked, not
 * when it finishes (13-RESEARCH.md "The background-function contract"), so
 * a caller awaiting this trigger pays milliseconds, not the processing
 * time.
 */
const DEFAULT_TRIGGER_TIMEOUT_MS = 5000;

export type VerifySecretResult = "verified" | "unauthorized" | "not-configured";

/**
 * Verifies a presented `Authorization` header against the configured
 * secret, mirroring `DRAIN_CRON_SECRET`'s check in
 * `app/api/ingest/drain/route.ts` exactly. Fails closed: an absent or
 * empty configured secret returns the distinct `"not-configured"` outcome
 * rather than ever verifying — an unset variable must disable the path,
 * never open it.
 *
 * Both sides are hashed first (`hashToken`, SHA-256 hex) so the buffers
 * handed to `timingSafeEqual` are always equal-length 32-byte digests — a
 * presented value of any length compares in constant time and can never
 * throw instead of returning `"unauthorized"`.
 */
export function verifyIngestProcessSecret(
  authHeader: string | null | undefined,
  configuredSecret: string | undefined
): VerifySecretResult {
  if (!configuredSecret) return "not-configured";

  const presented = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const presentedDigest = Buffer.from(hashToken(presented), "hex");
  const expectedDigest = Buffer.from(hashToken(configuredSecret), "hex");
  if (!timingSafeEqual(presentedDigest, expectedDigest)) return "unauthorized";
  return "verified";
}

export type TriggerBackgroundProcessingResult =
  | { outcome: "fired" }
  | { outcome: "failed"; message: string }
  | { outcome: "not-configured" };

export interface TriggerBackgroundProcessingDeps {
  /** Injected fetch — the platform's `fetch` in production, a mock in tests. */
  fetchImpl: typeof fetch;
  /**
   * The site's canonical public origin. Read from `NEXT_PUBLIC_SITE_URL` at
   * the CALL SITE, never in this module — that variable already exists in
   * this project precisely because a Netlify request reports a
   * deploy-unique host rather than the public one, and this repository has
   * been bitten by that before (quick-260902-ksy).
   *
   * Consequence stated plainly, because the origin is configured rather
   * than derived (T-13-49): a branch deploy whose variable still points at
   * production will invoke production's function. Since both share one
   * database, the right file is still processed — but the logs land on the
   * wrong deploy, and a reader chasing a missing invocation should know to
   * look there.
   */
  origin: string | undefined;
  /** The shared secret. Read at the call site, never here — keeps this module free of `process.env`. */
  secret: string | undefined;
  /** Defaults to a few seconds — the invocation only needs acknowledging, not completing. */
  timeoutMs?: number;
}

/** Never let a secret value survive into a message this function returns. */
function redactSecret(message: string, secret: string): string {
  return secret ? message.split(secret).join("[redacted]") : message;
}

/**
 * Fires the background function for one claimed file. Never throws, under
 * any input — every path resolves to a discriminated result so a caller
 * (`/api/ingest`'s POST handler, or the drain sweep) can log the outcome
 * and move on without a try/catch of its own.
 *
 * A failed or not-configured trigger must never fail the caller's own
 * request: the row this trigger is for is already correctly `pending`, and
 * the daily sweep is the backstop D-01 requires. This function only
 * reports; it is the caller's job to never let the report change its own
 * response.
 */
export async function triggerBackgroundProcessing(
  fileId: string,
  deps: TriggerBackgroundProcessingDeps
): Promise<TriggerBackgroundProcessingResult> {
  const { fetchImpl, origin, secret, timeoutMs = DEFAULT_TRIGGER_TIMEOUT_MS } = deps;

  if (!origin || !secret) {
    return { outcome: "not-configured" };
  }

  try {
    const res = await fetchImpl(`${origin}${INGEST_PROCESS_FUNCTION_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ fileId }),
      // Bounds the wait so a hung invocation cannot hold the caller's own
      // request open — the platform's own 202 should arrive almost
      // instantly; if it doesn't, something is wrong and this trigger
      // reports failed rather than block.
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      return {
        outcome: "failed",
        message: redactSecret(`background trigger responded ${res.status}`, secret),
      };
    }
    return { outcome: "fired" };
  } catch (err) {
    // AbortSignal.timeout() rejects with a DOMException named
    // "TimeoutError"; read the message defensively regardless of the
    // thrown value's shape, same convention as `lib/notify/slack.ts`'s
    // `postSlackAlert`.
    const message = err instanceof Error ? err.message : "background trigger failed";
    return { outcome: "failed", message: redactSecret(message, secret) };
  }
}
