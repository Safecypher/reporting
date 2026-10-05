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
 * The lease window: how long a claim (`ingested_files.processing_started_at`)
 * stays live before it is reclaimable by another caller.
 *
 * 180 seconds. The measured worst case for a whole file is ~38 seconds and a
 * single attempt is hard-bounded well below that by plan 13-05, so 180s is
 * several times longer than any attempt can legitimately run — a live
 * attempt can never have its claim stolen. It is also short enough that an
 * abandoned claim is reclaimable within minutes rather than hours.
 * `fn_try_acquire_drain_lock` (0040) uses ten minutes for a job-level mutex
 * that runs once a day; a per-file lease bounding one attempt is a smaller
 * thing and gets a proportionately smaller number.
 *
 * MUST equal the `p_lease_seconds` default in
 * `supabase/migrations/0048_ingest_processing_lease.sql`'s
 * `fn_try_claim_ingested_file` — a drifted pair is the one way this design
 * can produce two concurrent writers (a grep gate in this plan's Task 1
 * asserts the equality).
 */
export const PROCESSING_LEASE_SECONDS = 180;

/**
 * How old a `pending` row with no live lease must be before the drain
 * sweep's listing query considers it a candidate at all.
 *
 * 10 minutes. Far past any plausible in-flight first attempt, so the sweep
 * never races a browser that fired seconds ago. The lease already makes
 * that race safe (Pattern 3); this is the second, cheaper guard that keeps
 * the sweep's listing query from even selecting such a row.
 */
export const SWEEPABLE_AFTER_MINUTES = 10;

/**
 * How old a `pending` row with no live lease must be before it is surfaced
 * as genuinely stuck (D-03) rather than merely still converging.
 *
 * 6 hours. The drain runs once a day at 16:00 UTC. A file that arrived this
 * morning and is still `pending` by then genuinely failed, and six hours is
 * generous enough that a file converging across chained attempts under a
 * ~26s ceiling is not mistaken for a dead one — the false-alarm RESEARCH
 * Pitfall 1 warns this threshold must avoid.
 */
export const STUCK_PENDING_AFTER_HOURS = 6;

/**
 * The ceiling on self-chained continuations plan 13-05 may build.
 *
 * 10 attempts. Far more than any 44-batch file needs at a bounded slice
 * each; a file still unfinished after ten claims is not converging and
 * should be surfaced rather than retried forever.
 */
export const MAX_PROCESSING_ATTEMPTS = 10;

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
 */
export function isSweepable(facts: PendingFileFacts, asOf: Date): boolean {
  if (facts.status !== "pending") return false;
  if (hasLiveLease(facts.processingStartedAt, asOf)) return false;

  const ageMs = asOf.getTime() - facts.uploadedAt.getTime();
  return ageMs >= SWEEPABLE_AFTER_MINUTES * ONE_MINUTE_MS;
}
