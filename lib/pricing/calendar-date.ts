/**
 * isValidCalendarDate — a plain module, no `"use server"` directive, no
 * Supabase or Next imports (05-09, closing code-review WR-01 /
 * G-05-CR01 missing item 4).
 *
 * A `"use server"` module may only export async functions, so this
 * synchronous guard cannot live in `app/(dashboard)/settings/pricing/actions.ts`
 * and be tested directly — the same reasoning already recorded at the top of
 * `lib/pricing/errors.ts`.
 *
 * The guard it replaces (`isValidCalendarDate` previously defined inline in
 * `actions.ts`) paired a strict shape regex with `Date.parse`. That approach
 * is insufficient: `Date.parse` only reports failure for a STRUCTURALLY
 * malformed string (wrong shape, an impossible month) — it silently ROLLS
 * OVER an out-of-range day into the next month instead of rejecting it.
 * `Date.parse("2026-02-30T00:00:00Z")` returns a valid timestamp (1 March
 * 2026), not `NaN`. Postgres's own `date` column type remains the last line
 * of defence for anything this function might still miss — this function
 * exists to give the application a genuine, testable rejection before a
 * calendar-impossible date ever reaches a query.
 *
 * Implementation mirrors the in-repo precedent at
 * `lib/ingestion/file-date.ts:15-22`: split the components, reconstruct the
 * date via `Date.UTC`, and require the reconstructed UTC year/month/day to
 * equal the three input numbers exactly.
 */
const SHAPE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidCalendarDate(value: string): boolean {
  if (!SHAPE_RE.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const asUtc = new Date(Date.UTC(year, month - 1, day));

  return (
    asUtc.getUTCFullYear() === year &&
    asUtc.getUTCMonth() === month - 1 &&
    asUtc.getUTCDate() === day
  );
}
