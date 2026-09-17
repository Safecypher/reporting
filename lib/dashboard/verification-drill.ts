import type { createClient } from "@/lib/supabase/server";

import {
  DATA_WINDOW_START as DATA_WINDOW_START_DATE,
  DATA_WINDOW_START_TS,
  clampToDataWindow,
} from "./data-window";

/**
 * Shared "verification" drill-entity row shape, fetcher, and constants
 * (DASH-03/D-11). Previously duplicated verbatim between
 * app/(dashboard)/verifications/page.tsx and app/(dashboard)/revenue/page.tsx
 * (WR-04) — a single copy here means any future column/field change (or
 * fetch-limit change) only needs to happen once.
 *
 * Revenue's usage never filters by `authenticated` (D-02: all verifications
 * count toward revenue) — that's simply the caller omitting the optional
 * `authenticated` argument, not a second code path.
 */

/**
 * The timestamptz floor for `created_at`, defined once in `./data-window`
 * (08-01, WR-07) and kept under this file's existing export name/value so no
 * import site elsewhere in this codebase needs to change.
 */
export const DATA_WINDOW_START = DATA_WINDOW_START_TS;

/** PoC-scale cap on the drilled raw-row fetch — plenty for the current data volume. */
export const DRILL_ROW_LIMIT = 500;

export interface VerificationDrillRow {
  created_at: string;
  external_card_reference: string;
  duration_ms: number;
  authenticated: boolean;
}

export interface VerificationDrillFetchResult {
  rows: VerificationDrillRow[];
  /** Total matching row count from the DB (`count: "exact"`), or `null` on
   * query error / not fetched. WR-05: lets the caller show "Showing 500 of
   * {totalCount}" instead of silently truncating at DRILL_ROW_LIMIT. */
  totalCount: number | null;
}

/**
 * Server-fetches the raw rows contributing to the "verification" drill
 * entity. Whitelisted, parameterised: only `.eq()`/`.gte()` builders are
 * used, never raw string interpolation of `searchParams` (T-03-19). The
 * session-scoped client keeps RLS in effect (T-03-20).
 *
 * `range` (Phase 5, D-04): a drill opened from a period-scoped metric must
 * list only rows from that same period, or the drill silently contradicts
 * the scope badge shown above it. Callers pass the SAME `{start, end}` the
 * page's own daily query was scoped with (`lib/dashboard/period.ts`'s
 * `ResolvedPeriod`). Omitting `range` behaves exactly as before — the
 * DATA_WINDOW_START floor with no upper bound — so existing callers/tests
 * are unaffected.
 *
 * WR-03 (08-01): the lower bound is always ANDed with the floor via
 * `clampToDataWindow`, never replaced by `range.start` as a bare ternary —
 * a caller-supplied range can only NARROW the window within the floor, it
 * can never widen it below 2026-08-13, for any input.
 */
export async function fetchVerificationDrillRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  authenticated?: boolean,
  range?: { start: string; end: string | null },
): Promise<VerificationDrillFetchResult> {
  let query = supabase
    .from("verifications")
    .select("created_at, external_card_reference, duration_ms, authenticated", {
      count: "exact",
    })
    .gte("created_at", `${clampToDataWindow(range?.start ?? DATA_WINDOW_START_DATE)}T00:00:00Z`)
    .order("created_at", { ascending: false })
    .limit(DRILL_ROW_LIMIT);

  if (range?.end) {
    query = query.lt("created_at", `${range.end}T00:00:00Z`);
  }

  if (authenticated !== undefined) {
    query = query.eq("authenticated", authenticated);
  }

  const { data, error, count } = await query.returns<VerificationDrillRow[]>();
  if (error) return { rows: [], totalCount: null };
  return { rows: data ?? [], totalCount: count ?? null };
}
