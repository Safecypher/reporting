/**
 * The single named home for every threshold Phase 13 depends on (RESEARCH
 * Open Question 2), and the pure resolver both the /uploads screen
 * (lib/upload/history.ts, plan 13-03) and the drain sweep's Slack alert
 * (app/api/ingest/drain/route.ts, plan 13-06) read — the FRESH-04
 * one-resolver discipline (10-03) applied to this phase's new pending
 * state, so the two surfaces can never disagree about whether a row is
 * "processing" or "stuck".
 *
 * Deliberately pure: no import of `@supabase/*`, no clock access of its
 * own. Every exported function takes an explicit `asOf: Date` so it is
 * testable without faking the system clock and so a caller controls
 * exactly which instant a row's state is evaluated against.
 */

/**
 * Netlify's documented, non-configurable background-function execution
 * ceiling: fifteen minutes. [CITED: Netlify background-functions
 * documentation]. The same documentation states that if an invocation
 * itself fails to start, the platform retries after one minute, and then
 * two minutes after that — three minutes of possible delay before a
 * legitimate attempt is even running, which is why
 * `PROCESSING_LEASE_SECONDS` below gives the lease more margin over this
 * ceiling than the ceiling alone would need.
 *
 * This is a platform fact, not a tuning knob — every threshold in this
 * module is derived from it by a stated argument below, and the ordering
 * test compares against this name rather than a magic number.
 *
 * D-07 moved processing from a synchronous route (~26-38s worst case) to a
 * Netlify background function whose legitimate single attempt may run up
 * to this ceiling. The lease window below was previously sized for the old
 * world; this constant exists so the correction can be stated and gated
 * against a name.
 */
export const BACKGROUND_FUNCTION_CEILING_SECONDS = 900;

/**
 * The lease window: how long a claim (`ingested_files.processing_started_at`)
 * stays live before it is reclaimable by another caller.
 *
 * 1200 seconds (20 minutes). A single legitimate attempt is now a Netlify
 * background function that may run up to `BACKGROUND_FUNCTION_CEILING_SECONDS`
 * (900s). The lease must therefore strictly exceed the ceiling, or a second
 * caller can claim the same file via `fn_try_claim_ingested_file` while the
 * first is still genuinely running — exactly the double-writer bug this
 * constant exists to prevent (D-10, RESEARCH Pitfall 1). 1200 gives the
 * ceiling plus the platform's documented invocation-retry delay (up to
 * three minutes, per `BACKGROUND_FUNCTION_CEILING_SECONDS`'s doc comment —
 * covering an invocation that itself starts late and still needs its full
 * attempt) plus a small margin, so a claim taken at second 0 is still live
 * at second 899 of a legitimate attempt, and even a delayed one still
 * holds its lease when it finishes.
 *
 * MUST equal the `p_lease_seconds` default in
 * `supabase/migrations/0049_ingest_lease_window_for_background_functions.sql`'s
 * `fn_try_claim_ingested_file` — a drifted pair is the single way this
 * design can hand two writers the same file, and the pair is grep-gated
 * equal by this plan's Task 1/Task 2.
 */
export const PROCESSING_LEASE_SECONDS = 1200;

/**
 * How old a `pending` row with no live lease must be before the drain
 * sweep's listing query considers it a candidate at all.
 *
 * 30 minutes. Strictly past the 20-minute lease, so a row the listing query
 * selects can never be under a live lease even if the lease check were
 * somehow wrong, and strictly past `BACKGROUND_FUNCTION_CEILING_SECONDS`
 * (15 minutes), so the sweep cannot fire a trigger at a file that is still
 * legitimately running (D-10). The drain runs once a day, so widening this
 * window from the previous ten minutes to thirty changes nothing about how
 * quickly a stranded file is actually recovered in practice — on either
 * number, a file stranded at 15:55 waits for tomorrow's run.
 */
export const SWEEPABLE_AFTER_MINUTES = 30;

/**
 * How old a `pending` row with no live lease must be before it is surfaced
 * as genuinely stuck (D-03) rather than merely still converging.
 *
 * 6 hours. Under D-07 a healthy file succeeds in exactly one attempt — the
 * background-function ceiling is thirty times the measured worst-case file
 * — so an attempt count above one means a previous attempt genuinely
 * failed. Six hours is longer than any legitimate retry saga
 * `MAX_PROCESSING_ATTEMPTS` permits (four attempts at a twenty-minute lease
 * cannot span more than about eighty minutes of wall clock, comfortably
 * inside six hours) and shorter than the gap between daily drain runs, so a
 * file that arrived this morning and is still pending at 16:00 UTC
 * genuinely failed.
 */
export const STUCK_PENDING_AFTER_HOURS = 6;

/**
 * The cap on claim attempts before the drain sweep stops retrying a file.
 *
 * 4. Sized for a world with ONE attempt per success, not chained slices:
 * under D-07 a healthy file succeeds in exactly one attempt, because the
 * background-function ceiling is thirty times the measured worst-case
 * file. An attempt count above one therefore means a previous attempt
 * genuinely failed, and four is one real attempt plus three retries. Four
 * attempts at a twenty-minute lease cannot span more than about eighty
 * minutes of wall clock, comfortably inside `STUCK_PENDING_AFTER_HOURS`, so
 * the stuck alert never fires at a file that is still legitimately
 * retrying.
 *
 * Consulted only by `isSweepable` — a capped file stops being retried but
 * does not stop being reported; see that function's doc comment.
 */
export const MAX_PROCESSING_ATTEMPTS = 4;

const ONE_SECOND_MS = 1000;
const ONE_MINUTE_MS = 60 * ONE_SECOND_MS;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;

/** The facts a `resolvePendingState`/`isSweepable` caller supplies about one
 * `ingested_files` row — deliberately a plain data shape, not the raw DB row,
 * so both the /uploads screen and the drain sweep can map their own row
 * shapes onto it without this module knowing about either. `status` is a
 * bare `string` (not narrowed to the three-value CHECK) because a caller may
 * also pass `REJECTED_STATUS` (lib/upload/history.ts) — a sentinel the
 * `ingested_files.status` column itself never holds — and this resolver
 * must treat it the same as any other non-`pending` value: no pending state
 * at all. */
export interface PendingFileFacts {
  status: string;
  uploadedAt: Date;
  processingStartedAt: Date | null;
  processingAttempts: number;
}

/** A `pending` row reads as either genuinely in-flight or abandoned. There
 * is no third value — a non-`pending` row has no pending state at all
 * (`resolvePendingState` returns `null` for it). */
export type PendingState = "processing" | "stuck";

/** True iff `processingStartedAt` is a live lease as of `asOf` — strictly
 * newer than `PROCESSING_LEASE_SECONDS` before `asOf`. A lease exactly
 * `PROCESSING_LEASE_SECONDS` old is NOT live: the reclaim window matches the
 * SQL claim function's strictly-less-than comparison
 * (`f.processing_started_at < now() - make_interval(secs => p_lease_seconds)`),
 * so the two must agree at the boundary as everywhere else. */
function hasLiveLease(processingStartedAt: Date | null, asOf: Date): boolean {
  if (processingStartedAt === null) return false;
  const ageMs = asOf.getTime() - processingStartedAt.getTime();
  return ageMs < PROCESSING_LEASE_SECONDS * ONE_SECOND_MS;
}

/**
 * Resolves what a `pending` row's state actually is right now.
 *
 * Returns `null` for any status other than `pending` (`done`, `failed`, the
 * `REJECTED_STATUS` sentinel, or anything else) — a non-pending row has no
 * pending state at all.
 *
 * For a `pending` row: a live lease always wins over age and returns
 * `"processing"` — a three-day-old file being swept right now genuinely IS
 * processing for those seconds, and saying otherwise would be false.
 * Without a live lease, age since `uploadedAt` decides: at or past
 * `STUCK_PENDING_AFTER_HOURS` returns `"stuck"`; anything younger returns
 * `"processing"` (a fresh, unclaimed row is presumed to be about to be
 * picked up, not yet abandoned).
 *
 * Deliberately unaffected by `MAX_PROCESSING_ATTEMPTS`: a row that has
 * burned the attempt cap still resolves exactly as its lease/age would
 * otherwise say. The cap stops the sweep from retrying a file
 * (`isSweepable`); it must not also stop the file from being reported,
 * or a deterministically-failing file would silently disappear from both
 * surfaces that read this resolver instead of surfacing as stuck.
 */
export function resolvePendingState(
  facts: PendingFileFacts,
  asOf: Date,
): PendingState | null {
  if (facts.status !== "pending") return null;

  if (hasLiveLease(facts.processingStartedAt, asOf)) {
    return "processing";
  }

  const ageMs = asOf.getTime() - facts.uploadedAt.getTime();
  if (ageMs >= STUCK_PENDING_AFTER_HOURS * ONE_HOUR_MS) {
    return "stuck";
  }

  return "processing";
}

/**
 * True iff a `pending` row is old enough, and not under a live lease, for
 * the drain sweep's listing query to pick it up as a candidate to claim and
 * process. A `done`/`failed`/rejected row is never sweepable at any age —
 * there is nothing left to do with it.
 *
 * Also false once `processingAttempts` reaches `MAX_PROCESSING_ATTEMPTS`,
 * checked after the status check and before the lease check, and
 * independently of it — a capped row is not sweepable whether or not it
 * currently holds a live lease. This is deliberately a sweep rule, not a
 * `resolvePendingState` rule: a capped file should stop being retried, but
 * it must not stop being REPORTED. It is exactly the file the stuck alert
 * exists for, and suppressing it from both surfaces would let a
 * deterministically broken file silently disappear instead of surfacing as
 * stuck once it crosses `STUCK_PENDING_AFTER_HOURS`.
 */
export function isSweepable(facts: PendingFileFacts, asOf: Date): boolean {
  if (facts.status !== "pending") return false;
  if (facts.processingAttempts >= MAX_PROCESSING_ATTEMPTS) return false;
  if (hasLiveLease(facts.processingStartedAt, asOf)) return false;

  const ageMs = asOf.getTime() - facts.uploadedAt.getTime();
  return ageMs >= SWEEPABLE_AFTER_MINUTES * ONE_MINUTE_MS;
}
