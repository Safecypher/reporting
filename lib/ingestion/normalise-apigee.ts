import type { ApigeeRow } from "./parsers/apigee-stats";

/** DATA-06: no data before this instant is trustworthy — same cutoff as every other report type. */
const DATA_WINDOW_START = Date.parse("2026-08-13T00:00:00Z");

/** Extracts the card reference from a cvv-fetch path suffix. */
const CARD_REF_PATH = /^\/CardEntities\/([^/]+)\/DynamicSecurityCode$/;

/**
 * D-09: map an APIGEE `what_proxy_pathsuffix` to a business-meaningful
 * `endpoint_category` + (where present) the `external_card_reference`.
 * Both fields are nullable on no-match — NEVER guess.
 */
export function deriveEndpointCategory(pathSuffix: string): {
  endpointCategory: string | null;
  externalCardReference: string | null;
} {
  if (pathSuffix === "/Verify") return { endpointCategory: "verify", externalCardReference: null };
  if (pathSuffix === "/activateCardEntity")
    return { endpointCategory: "enrol", externalCardReference: null };
  if (pathSuffix === "/removeCards")
    return { endpointCategory: "unenrol", externalCardReference: null };
  const match = CARD_REF_PATH.exec(pathSuffix);
  if (match) return { endpointCategory: "cvv-fetch", externalCardReference: match[1] };
  return { endpointCategory: null, externalCardReference: null };
}

export interface NormalisedApigeeRow {
  event_time: string;
  raw_event_time: string;
  raw_path_suffix: string;
  endpoint_category: string | null;
  external_card_reference: string | null;
  response_code: number;
}

export interface NormaliseApigeeResult {
  rows: NormalisedApigeeRow[];
  /** Valid rows dropped by the DATA-06 cutoff — counted, never silently swallowed (CR-02). */
  excludedPreWindow: number;
}

/**
 * Convert validated APIGEE rows into the shape `upsertRows('apigee_calls', ...)`
 * expects, and apply the DATA-06 cutoff. `row_hash` is deliberately absent —
 * it is a Postgres `GENERATED ALWAYS ... STORED` column (see 0010 migration).
 *
 * The `Time` cell is already a JS `Date` (ExcelJS's built-in numFmt coercion,
 * D-10) — `.toISOString()` directly, no naive→UTC assumption needed here
 * (unlike card-inventory/removed-cards' truly naive timestamps).
 */
export function normaliseApigee(rows: ApigeeRow[]): NormaliseApigeeResult {
  const normalised: NormalisedApigeeRow[] = [];
  let excludedPreWindow = 0;

  for (const row of rows) {
    const eventTimeMs = row.time.getTime();
    if (!Number.isFinite(eventTimeMs) || eventTimeMs < DATA_WINDOW_START) {
      excludedPreWindow += 1;
      continue;
    }
    const rawEventTime = row.time.toISOString();
    const { endpointCategory, externalCardReference } = deriveEndpointCategory(row.pathSuffix);
    normalised.push({
      event_time: rawEventTime,
      raw_event_time: rawEventTime,
      raw_path_suffix: row.pathSuffix,
      endpoint_category: endpointCategory,
      external_card_reference: externalCardReference,
      response_code: row.responseCode,
    });
  }

  return { rows: normalised, excludedPreWindow };
}
