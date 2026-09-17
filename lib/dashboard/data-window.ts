/**
 * The single TypeScript source of truth for the DATA-06 reliable-data floor
 * (2026-08-13) across `lib/dashboard/*`. A LEAF MODULE: no imports at all
 * (not even type-only ones), so every other dashboard module can depend on
 * it by relative import with zero risk of the `@/`-alias divergence
 * `card-inventory.ts` previously documented inline — a value import through
 * the `@/` path alias can resolve differently under `next build` than under
 * `vitest run` depending on this repo's alias configuration at any given
 * time; a relative import of a module with no imports of its own can never
 * be affected by that question either way.
 *
 * The SQL side has its OWN copy of this floor: `data_window_start()`, added
 * in migration 0039 (plan 08-03). The two are NOT wired together across the
 * TS/SQL boundary — a shared constant in one language is not a shared
 * constant across the wire — so any future change to the floor date must
 * update BOTH this file and the SQL function by hand.
 *
 * Deliberately OUT OF SCOPE (08-01-PLAN.md, WR-07 scoping): the six
 * `lib/ingestion/normalise*.ts` files each hold their own copy of the floor
 * as `Date.parse("2026-08-13T00:00:00Z")` (a number, used at parse time), on
 * an ingestion code path this phase does not otherwise touch. Consolidating
 * those into this module is a separate, lower-risk sweep — naming the
 * deferral here so a future reader does not mistake this consolidation as
 * having already covered them.
 */

/** The earliest reliable calendar day, `"YYYY-MM-DD"` form. */
export const DATA_WINDOW_START = "2026-08-13";

/** The earliest reliable instant, timestamptz form. */
export const DATA_WINDOW_START_TS = "2026-08-13T00:00:00Z";

/**
 * Clamps `date` ("YYYY-MM-DD") up to the data-window floor when it falls
 * before it, otherwise returns `date` unchanged. Lexicographic string
 * comparison is valid for ISO `YYYY-MM-DD` dates — the same convention
 * `card-inventory.ts`'s `rowsWithin` already relies on for its own window
 * filtering.
 */
export function clampToDataWindow(date: string): string {
  return date < DATA_WINDOW_START ? DATA_WINDOW_START : date;
}
