/**
 * Pure constants and clamp logic for the function-ceiling probe
 * (app/api/diagnostics/function-ceiling/route.ts). D-05 rates the
 * chained-attempt processing design one-way-door-ish: building it and then
 * discovering a 60s ceiling means carrying complexity that was never
 * needed. This module exists so the real synchronous ceiling of this
 * deployed site's `maxDuration = 60` Route Handlers can be MEASURED rather
 * than assumed — RESEARCH Pitfall 1 names exactly why the already-declared
 * `maxDuration = 60` on two existing routes is not itself evidence of
 * anything.
 *
 * Deliberately pure: no network, no Supabase import, no `next/*` import —
 * the route wraps this with the actual I/O loop and the session check.
 */

/**
 * The hard ceiling on what any caller may request the probe hold a
 * connection open for.
 *
 * 55, not 60: the route declares `maxDuration = 60`, and a probe allowed to
 * request the full 60 would conflate "the platform cut me" with "my own
 * declaration cut me". Leaving five seconds of headroom means a failure to
 * return is a platform fact, not a self-inflicted one.
 */
export const PROBE_MAX_SECONDS = 55;

/** Used when no `seconds` query parameter is supplied, or it fails to
 * parse — never left to produce an unbounded or NaN duration. */
export const PROBE_DEFAULT_SECONDS = 20;

/**
 * The ascending sequence a human walks up when measuring this site's real
 * ceiling (this plan's Task 3). 26 is on the ladder because it is the
 * number this project measured on 2026-10-05 — the whole point of the
 * exercise is to find out whether that number is still true on a route
 * that actually declares `maxDuration = 60`. 60 itself is excluded because
 * it exceeds `PROBE_MAX_SECONDS`.
 */
export const PROBE_LADDER: readonly number[] = [10, 20, 26, 30, 40, 50, 55];

/**
 * Clamps a raw `seconds` query-string value to a safe whole number of
 * seconds the probe may hold a request open for.
 *
 * - `null` or an empty/whitespace-only string returns `PROBE_DEFAULT_SECONDS`.
 * - A non-numeric string returns `PROBE_DEFAULT_SECONDS` rather than `NaN` —
 *   a typo must not produce an unbounded loop.
 * - Zero or any negative value returns `1` — the floor, so the probe always
 *   performs at least one round trip.
 * - A fractional value is truncated to a whole number of seconds.
 * - A value above `PROBE_MAX_SECONDS` returns `PROBE_MAX_SECONDS` exactly.
 */
export function clampProbeSeconds(raw: string | null): number {
  if (raw === null || raw.trim() === "") {
    return PROBE_DEFAULT_SECONDS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return PROBE_DEFAULT_SECONDS;
  }

  const truncated = Math.trunc(parsed);
  if (truncated <= 0) {
    return 1;
  }
  if (truncated > PROBE_MAX_SECONDS) {
    return PROBE_MAX_SECONDS;
  }
  return truncated;
}
