/**
 * Pure parse/serialize of the `?drill=...&date=...&...` URL contract (D-10).
 * No network/DOM access — safe to unit test. Extended by Phase 4, which adds
 * the "recon-billing" and "recon-inventory" entities without touching this
 * whitelist's shape.
 *
 * Security note (T-03-19): `drill` and every filter key are validated against
 * an explicit whitelist here. Never pass raw `searchParams` through to a
 * Supabase query builder — always go through `parseDrillParams` first, and
 * only read the typed fields off the returned `DrillFilter`.
 */

export type DrillEntity =
  | "verification"
  | "revenue-tier"
  | "sla-breach"
  | "recon-billing"
  | "recon-inventory";

export interface DrillFilter {
  drill: DrillEntity;
  date?: string;
  authenticated?: boolean;
  tierOrder?: number;
}

const DRILL_ENTITIES: readonly DrillEntity[] = [
  "verification",
  "revenue-tier",
  "sla-breach",
  "recon-billing",
  "recon-inventory",
];

type RawSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isDrillEntity(value: string | undefined): value is DrillEntity {
  return value !== undefined && (DRILL_ENTITIES as readonly string[]).includes(value);
}

/**
 * Strict `YYYY-MM-DD` shape check. Combined with `Date.parse` below to also
 * reject calendar-invalid dates like `2026-13-99` (the regex alone would
 * accept those) — see CR-02.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDrillDate(value: string): boolean {
  return DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/**
 * Parses raw URL search params into a whitelisted `DrillFilter`. Returns
 * `null` when `drill` is missing or not one of the exact allowed entities.
 * Any key not explicitly read below is silently dropped — this function is
 * the single choke point that prevents arbitrary query-string tampering from
 * reaching a database query.
 */
export function parseDrillParams(params: RawSearchParams): DrillFilter | null {
  const drill = firstValue(params.drill);
  if (!isDrillEntity(drill)) return null;

  const filter: DrillFilter = { drill };

  // CR-02: a malformed `date` (non-ISO, or calendar-invalid like
  // 2026-13-99) is silently dropped rather than passed through — callers
  // building a day-range query from `filter.date` would otherwise construct
  // `new Date(NaN)` and throw `RangeError: Invalid time value` deep inside a
  // Server Component render.
  const date = firstValue(params.date);
  if (date !== undefined && isValidDrillDate(date)) {
    filter.date = date;
  }

  const authenticatedRaw = firstValue(params.authenticated);
  if (authenticatedRaw === "true") {
    filter.authenticated = true;
  } else if (authenticatedRaw === "false") {
    filter.authenticated = false;
  }

  const tierOrderRaw = firstValue(params.tierOrder);
  if (tierOrderRaw !== undefined) {
    const parsed = Number.parseInt(tierOrderRaw, 10);
    if (Number.isInteger(parsed)) {
      filter.tierOrder = parsed;
    }
  }

  return filter;
}

/** Serializes a `DrillFilter` back into string URL params (round-trips `parseDrillParams`). */
export function serializeDrillParams(filter: DrillFilter): Record<string, string> {
  const out: Record<string, string> = { drill: filter.drill };

  if (filter.date !== undefined) {
    out.date = filter.date;
  }
  if (filter.authenticated !== undefined) {
    out.authenticated = String(filter.authenticated);
  }
  if (filter.tierOrder !== undefined) {
    out.tierOrder = String(filter.tierOrder);
  }

  return out;
}
