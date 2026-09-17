// No date-fns import here: every helper below operates on UTC instants
// (Date.UTC construction) exclusively via getUTC*/setUTC* accessors.
// date-fns's own `format`/`addMonths`/`getDaysInMonth` read/write LOCAL
// getters internally, which would silently shift a UTC-midnight instant by
// a day whenever this code runs in a non-UTC process timezone — exactly the
// zone-leakage D-05 forbids. See the UTC-safe helpers below instead.

/**
 * Pure resolution of the `?period=&of=&yearMode=` URL contract (D-01) plus
 * the fetched `app_settings` financial-year start into a `[start, end)` UTC
 * date range (D-05). No network/DOM access — `today` is always an injected
 * parameter, never read from the wall clock, so this module is safe to unit
 * test and to call from a Server Component on every render.
 *
 * Whitelist + defaulting pattern mirrors `drill-params.ts`'s `firstValue`
 * shape and its `DATE_RE` + `Date.parse` calendar-validity pairing, with one
 * critical divergence (T-05-01): `parseDrillParams` returns `null` on
 * invalid input, but `resolvePeriod` must ALWAYS return a valid, resolved
 * period — anything unrecognised falls back to the D-03 current-month
 * default rather than returning null (UI-SPEC E1 "error" row). Any key not
 * explicitly read here is silently dropped, and the `drill`/`date`/
 * `authenticated`/`tierOrder` keys `drill-params.ts` owns are never touched
 * — the two whitelists coexist on the same URL.
 */

import { DATA_WINDOW_START, clampToDataWindow } from "./data-window";

export type PeriodScope = "month" | "year" | "all";
export type YearMode = "calendar" | "financial";

export interface FinancialYearStart {
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
}

export interface ResolvedPeriod {
  scope: PeriodScope;
  /** null unless scope === "year" */
  yearMode: YearMode | null;
  /** canonical "YYYY-MM" (month) / "YYYY" (year); null for "all" */
  of: string | null;
  /** "YYYY-MM-DD", INCLUSIVE */
  start: string;
  /** "YYYY-MM-DD", EXCLUSIVE; null means open-ended ("all") */
  end: string | null;
  /** e.g. "August 2026" | "2026 (calendar year)" | "FY2026-27 (6 Apr 2026 - 5 Apr 2027)" | "all time" */
  label: string;
}

type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * The earliest reliable day (08-01, WR-07: TypeScript-side dashboard
 * cluster consolidation) — the single definition now lives in the
 * zero-import leaf module `./data-window`; re-exported here under its
 * existing name so no import site elsewhere in this codebase needs to
 * change.
 */
export { DATA_WINDOW_START };

/** P-01: calendar, not financial — see 05-01-PLAN.md planner_decisions. */
export const DEFAULT_YEAR_MODE: YearMode = "calendar";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function utcDateFromParts(year: number, month1to12: number, day: number): Date {
  return new Date(Date.UTC(year, month1to12 - 1, day));
}

function toDateOnlyString(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * Days in `month1to12`/`year`, computed purely via `Date.UTC` (day 0 of the
 * next month is the last day of this one) — never date-fns's `getDaysInMonth`,
 * which reads local getters.
 */
export function daysInUtcMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/**
 * Clamps `day` to the last valid day of the given UTC month/year, matching
 * `resolveFinancialYearBounds`'s documented clamp (e.g. a 31-day FY start
 * landing in a 30-day month becomes that month's 30th).
 */
function clampDayInMonth(year: number, month1to12: number, day: number): number {
  return Math.min(day, daysInUtcMonth(year, month1to12));
}

/** UTC-safe "d MMM yyyy" formatter (e.g. "6 Apr 2026") — never date-fns's
 * `format`, which reads local getters and would misdate a UTC-midnight
 * instant by a day in a non-UTC process timezone. */
function formatUtcDayLabel(d: Date): string {
  return `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;
}

/** Adds `count` calendar months to a UTC-midnight instant, via UTC getters
 * only (never date-fns's `addMonths`, which uses local getters/setters). */
function addUtcMonths(d: Date, count: number): Date {
  const totalMonths = d.getUTCFullYear() * 12 + d.getUTCMonth() + count;
  const year = Math.floor(totalMonths / 12);
  const month0 = totalMonths % 12;
  return new Date(Date.UTC(year, month0, d.getUTCDate()));
}

const MONTH_OF_RE = /^\d{4}-\d{2}$/;
const YEAR_OF_RE = /^\d{4}$/;

function isCalendarValidMonth(year: number, month: number): boolean {
  if (month < 1 || month > 12) return false;
  // Date.UTC normalises out-of-range values silently, so re-check the
  // round-trip explicitly (same "regex alone isn't enough" pairing as
  // drill-params.ts's DATE_RE + Date.parse for calendar-invalid dates).
  const d = new Date(Date.UTC(year, month - 1, 1));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1;
}

function currentUtcMonthOf(today: Date): string {
  return `${today.getUTCFullYear()}-${pad2(today.getUTCMonth() + 1)}`;
}

function currentUtcYearOf(today: Date): string {
  return String(today.getUTCFullYear());
}

/**
 * D-12 gate (RESEARCH Pitfall 5): `resolvePeriod` returning successfully is
 * NOT evidence that the resolved period is the current one — it also
 * succeeds for every valid past month, so "is this the current month" must
 * be asked explicitly rather than inferred from a successful resolution.
 * True only for a month-scoped period whose `of` equals the current UTC
 * month of `today`; false for a year-scoped or all-time period regardless of
 * `today`. Pure — no clock of its own, `today` is always the caller's.
 */
export function isCurrentUtcMonthPeriod(period: ResolvedPeriod, today: Date): boolean {
  return period.scope === "month" && period.of === currentUtcMonthOf(today);
}

/**
 * D-12 gate (RESEARCH Pitfall 5): the year-scope counterpart to
 * `isCurrentUtcMonthPeriod` — `resolvePeriod` succeeding is not evidence the
 * resolved year is the current one, since it also succeeds for every valid
 * past year. True for a year-scoped period whose `of` equals the current UTC
 * year, in BOTH calendar and financial year modes (`yearMode` is deliberately
 * ignored: a financial year whose `of` is the current year is still the
 * current year for projection purposes). False for a month-scoped or
 * all-time period regardless of `today`. Pure — no clock of its own.
 */
export function isCurrentUtcYearPeriod(period: ResolvedPeriod, today: Date): boolean {
  return period.scope === "year" && period.of === currentUtcYearOf(today);
}

/**
 * D-12 gate (RESEARCH Pitfall 5): whether a projection should even be
 * attempted for `period` — the disjunction of the two current-period checks
 * above, additionally requiring a bounded horizon (`period.end` non-null,
 * which rules out the all-time scope structurally as well as belt-and-braces
 * for any future scope that might resolve to an open end). Pure — no clock
 * of its own; `today` is always the single value the caller already
 * captured.
 */
export function isProjectablePeriod(period: ResolvedPeriod, today: Date): boolean {
  return (
    period.end !== null &&
    (isCurrentUtcMonthPeriod(period, today) || isCurrentUtcYearPeriod(period, today))
  );
}

function monthBounds(of: string): { start: string; end: string } {
  const [yearStr, monthStr] = of.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const start = utcDateFromParts(year, month, 1);
  const end = new Date(Date.UTC(year, month, 1)); // first of next month
  return { start: toDateOnlyString(start), end: toDateOnlyString(end) };
}

function calendarYearBounds(of: string): { start: string; end: string } {
  const year = Number(of);
  const start = utcDateFromParts(year, 1, 1);
  const end = utcDateFromParts(year + 1, 1, 1);
  return { start: toDateOnlyString(start), end: toDateOnlyString(end) };
}

function monthLabel(of: string): string {
  const [yearStr, monthStr] = of.split("-");
  const month = Number(monthStr);
  return `${MONTH_NAMES[month - 1]} ${yearStr}`;
}

/**
 * Given a financial-year start (month + day) and `today`, returns the
 * `[start, end)` bounds of the FY containing `today`. The FY starts in
 * `today`'s own year when `today` is on or after `{month, day}` in that
 * year, otherwise it started the previous year. `fyLabel` is
 * `FY<startYear>-<last two digits of startYear+1>`.
 *
 * A `day` that does not exist in the target month (e.g. day 31 landing in a
 * 30-day month) is clamped down to that month's last day — documented here
 * rather than raising, since the DB-level `make_date` CHECK constraint
 * (0023) already prevents an impossible day from ever being stored; this
 * clamp is defence-in-depth for a value read before that constraint existed
 * or supplied directly to this pure function in a test.
 */
export function resolveFinancialYearBounds(
  fyStart: FinancialYearStart,
  today: Date,
): { start: Date; end: Date; fyLabel: string } {
  const todayMonth = today.getUTCMonth() + 1;
  const todayDay = today.getUTCDate();

  const onOrAfterStart =
    todayMonth > fyStart.month || (todayMonth === fyStart.month && todayDay >= fyStart.day);

  const startYear = onOrAfterStart ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
  const endYear = startYear + 1;

  const startDay = clampDayInMonth(startYear, fyStart.month, fyStart.day);
  const endDay = clampDayInMonth(endYear, fyStart.month, fyStart.day);

  const start = utcDateFromParts(startYear, fyStart.month, startDay);
  const end = utcDateFromParts(endYear, fyStart.month, endDay);
  const fyLabel = `FY${startYear}-${String(endYear).slice(-2)}`;

  return { start, end, fyLabel };
}

function financialYearLabel(fyStart: FinancialYearStart, today: Date): {
  start: string;
  end: string;
  label: string;
} {
  const { start, end, fyLabel } = resolveFinancialYearBounds(fyStart, today);
  const startStr = toDateOnlyString(start);
  const endStr = toDateOnlyString(end);
  // The bracketed label shows the INCLUSIVE end (end minus one day) — the
  // exclusive boundary itself is never displayed (UI-SPEC Copywriting
  // Contract). end is always >= start + 1 day, so subtracting one day never
  // underflows into the previous era.
  const inclusiveEnd = new Date(end);
  inclusiveEnd.setUTCDate(inclusiveEnd.getUTCDate() - 1);
  const inclusiveEndStr = formatUtcDayLabel(inclusiveEnd);
  const startLabelStr = formatUtcDayLabel(start);
  return {
    start: startStr,
    end: endStr,
    label: `${fyLabel} (${startLabelStr} - ${inclusiveEndStr})`,
  };
}

/**
 * Returns the resolved default period: current-month scope (D-03), UTC
 * `today`.
 */
function defaultPeriod(today: Date): ResolvedPeriod {
  const of = currentUtcMonthOf(today);
  const { start, end } = monthBounds(of);
  return {
    scope: "month",
    yearMode: null,
    of,
    start,
    end,
    label: monthLabel(of),
  };
}

const DATA_WINDOW_OF_MONTH = DATA_WINDOW_START.slice(0, 7); // "2026-08"
const DATA_WINDOW_OF_YEAR = DATA_WINDOW_START.slice(0, 4); // "2026"

/**
 * Reads only the `period`, `of` and `yearMode` keys from `params` — every
 * other key (including `drill-params.ts`'s own whitelist) is silently
 * dropped. Unlike `parseDrillParams`, this never returns null: anything
 * unrecognised falls back to the D-03 default (scope "month", `of` = the
 * current UTC month).
 */
export function resolvePeriod(
  params: RawSearchParams,
  fyStart: FinancialYearStart,
  today: Date,
): ResolvedPeriod {
  const periodRaw = firstValue(params.period);
  const ofRaw = firstValue(params.of);
  const yearModeRaw = firstValue(params.yearMode);

  const yearMode: YearMode =
    yearModeRaw === "calendar" || yearModeRaw === "financial" ? yearModeRaw : DEFAULT_YEAR_MODE;

  if (periodRaw === "all") {
    return {
      scope: "all",
      yearMode: null,
      of: null,
      start: DATA_WINDOW_START,
      end: null,
      label: "all time",
    };
  }

  if (periodRaw === "year") {
    // UI-SPEC E1 partial: ?period=year with no `of` resolves to the current year.
    let of = currentUtcYearOf(today);
    if (ofRaw !== undefined && YEAR_OF_RE.test(ofRaw)) {
      const yearNum = Number(ofRaw);
      const notFuture = yearNum <= today.getUTCFullYear();
      const notPreWindow = ofRaw >= DATA_WINDOW_OF_YEAR;
      if (notFuture && notPreWindow) {
        of = ofRaw;
      }
    }

    if (yearMode === "financial") {
      // WR-04: derive the FY bounds identically for every year, past or
      // current — always anchored to 31 December of `of`, never to the
      // literal wall clock. The prior special case (`today` for the
      // current year, 31 Dec of `of` for every other year) made
      // `resolveFinancialYearBounds`'s `startYear` decision depend on
      // which side of the FY start day `today` fell on — so the SAME `of`
      // could silently flip to a different FY the moment the clock crossed
      // that boundary mid-session, with no user action. Anchoring
      // unconditionally to 31 December makes this branch a pure function of
      // `(fyStart, of)` — `today` still matters elsewhere in this `year`
      // branch (the `notFuture` guard above and the D-03 default `of`), it
      // just never reaches `resolveFinancialYearBounds` directly any more.
      const targetToday = utcDateFromParts(Number(of), 12, 31);
      const { start, end, label } = financialYearLabel(fyStart, targetToday);
      // WR-03: clamp `start` only — `resolveFinancialYearBounds` has no
      // notion of the data window, so an FY start earlier in the calendar
      // year than 13 Aug 2026 would otherwise return a `start` there is no
      // reliable data for (e.g. a 6 April FY start resolving four months
      // below the floor). `end` is an EXCLUSIVE upper bound and is not
      // floored by anything — only `start` is ever clamped, for any scope.
      // The label keeps the FY's true calendar span (a fact about the
      // financial year, not about the data) and is never rewritten to the
      // clamped date.
      //
      // Copywriting Contract note (07-UI-SPEC.md convention): when the
      // clamp actually bites — i.e. `clampToDataWindow(start) !== start`
      // below — the figures for this period cover less than `label`'s
      // stated span, and that gap should be surfaced the way the existing
      // partial-coverage captions are (e.g. card-inventory's as-of/
      // carried-forward notices), not left to imply full coverage silently.
      // 08-01's `files_modified` has no UI component files, so wiring an
      // actual on-screen notice is left to a future plan; this note records
      // the intended copy so it isn't lost: "Showing data from 13 Aug 2026
      // — {label}'s calendar start predates the earliest reliable data."
      return {
        scope: "year",
        yearMode: "financial",
        of,
        start: clampToDataWindow(start),
        end,
        label,
      };
    }

    const { start, end } = calendarYearBounds(of);
    return {
      scope: "year",
      yearMode: "calendar",
      of,
      start,
      end,
      label: `${of} (calendar year)`,
    };
  }

  if (periodRaw === "month" || periodRaw === undefined) {
    // UI-SPEC E1 partial: `of` with no `period` is ignored in favour of the
    // default — neither is an error. Only honour `of` when `period=month`
    // was explicit (matching D-03's "no unscoped default path" intent).
    if (periodRaw === "month" && ofRaw !== undefined && MONTH_OF_RE.test(ofRaw)) {
      const [yearStr, monthStr] = ofRaw.split("-");
      const year = Number(yearStr);
      const month = Number(monthStr);
      if (
        isCalendarValidMonth(year, month) &&
        ofRaw <= currentUtcMonthOf(today) &&
        ofRaw >= DATA_WINDOW_OF_MONTH
      ) {
        const { start, end } = monthBounds(ofRaw);
        return {
          scope: "month",
          yearMode: null,
          of: ofRaw,
          start,
          end,
          label: monthLabel(ofRaw),
        };
      }
    }
    return defaultPeriod(today);
  }

  // Unrecognised `period` value — fall back to the D-03 default.
  return defaultPeriod(today);
}

/**
 * Every UTC month from `DATA_WINDOW_START`'s month through the current UTC
 * month, reverse-chronological. Calendar-derived, never data-derived (UI-SPEC
 * E9 partial: a month with no rows is still offered).
 */
export function monthOptions(today: Date): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const [startYearStr, startMonthStr] = DATA_WINDOW_START.split("-");
  let cursor = utcDateFromParts(Number(startYearStr), Number(startMonthStr), 1);
  const currentMonthStart = utcDateFromParts(
    today.getUTCFullYear(),
    today.getUTCMonth() + 1,
    1,
  );

  while (cursor.getTime() <= currentMonthStart.getTime()) {
    const of = `${cursor.getUTCFullYear()}-${pad2(cursor.getUTCMonth() + 1)}`;
    options.push({ value: of, label: monthLabel(of) });
    cursor = addUtcMonths(cursor, 1);
  }

  return options.reverse();
}

/**
 * Every UTC year from `DATA_WINDOW_START`'s year through the current UTC
 * year, reverse-chronological. Calendar-derived, never data-derived.
 */
export function yearOptions(today: Date): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const startYear = Number(DATA_WINDOW_START.slice(0, 4));
  const currentYear = today.getUTCFullYear();

  for (let year = startYear; year <= currentYear; year += 1) {
    options.push({ value: String(year), label: String(year) });
  }

  return options.reverse();
}

/**
 * Serializes a `ResolvedPeriod` back into URL params. Round-trips through
 * `resolvePeriod` for every scope: `scope: "all"` omits both `of` and
 * `yearMode`; `scope: "month"` omits `yearMode`; `scope: "year"` includes
 * `yearMode`.
 */
export function serializePeriodParams(p: ResolvedPeriod): Record<string, string> {
  if (p.scope === "all") {
    return { period: "all" };
  }

  if (p.scope === "month") {
    const out: Record<string, string> = { period: "month" };
    if (p.of !== null) out.of = p.of;
    return out;
  }

  // scope === "year"
  const out: Record<string, string> = { period: "year" };
  if (p.of !== null) out.of = p.of;
  out.yearMode = p.yearMode ?? DEFAULT_YEAR_MODE;
  return out;
}
