import { describe, expect, it } from "vitest";
import {
  mapPricingSaveError,
  mapPricingDeleteError,
  PRICING_ALREADY_DELETED,
  PRICING_DATA_WINDOW_BLOCKED,
  PRICING_DUPLICATE_EFFECTIVE_FROM,
  PRICING_GENERIC_DELETE_ERROR,
  PRICING_GENERIC_SAVE_ERROR,
  PRICING_TIER_CONTIGUITY_ERROR,
} from "../errors";

// 05-07 (G-05-5 missing item 3): the effective_from collision message
// previously rendered in destructive red for what is a validation block,
// not a destructive act. This is the ONLY behavioural change in this
// extraction — every other mapped result keeps its copy and tone verbatim.
const EFFECTIVE_FROM_COLLISION_RAW =
  'duplicate key value violates unique constraint "pricing_tier_sets_effective_from_key"';

const DATA_WINDOW_SAVE_RAW =
  "this change would leave the data window (from 2026-08-13) with no effective tier set";
const DATA_WINDOW_DELETE_RAW =
  "pricing_tier_sets_20 is the only tier set covering the data window (from 2026-08-13)";

const MISSING_TIER_SET_RAW = "no pricing tier set found for id 00000000-0000-0000-0000-000000000000";

const TIER_INTEGRITY_RAW_MESSAGES = [
  "the last tier must be open-ended",
  "tiers must have contiguous tier_order starting at 0",
  "tiers must have ascending upper_bound values",
];

const ALL_SAVE_CONSTANTS = [
  PRICING_DUPLICATE_EFFECTIVE_FROM,
  PRICING_DATA_WINDOW_BLOCKED,
  PRICING_ALREADY_DELETED,
  PRICING_TIER_CONTIGUITY_ERROR,
  PRICING_GENERIC_SAVE_ERROR,
];

const ALL_DELETE_CONSTANTS = [
  PRICING_DATA_WINDOW_BLOCKED,
  PRICING_ALREADY_DELETED,
  PRICING_GENERIC_DELETE_ERROR,
];

describe("mapPricingSaveError", () => {
  it("maps the effective_from unique-constraint text to WARNING tone (not destructive)", () => {
    const result = mapPricingSaveError(EFFECTIVE_FROM_COLLISION_RAW);
    expect(result.tone).toBe("warning");
  });

  it("the effective_from collision message names both recovery routes", () => {
    const result = mapPricingSaveError(EFFECTIVE_FROM_COLLISION_RAW);
    expect(result.message).toBe(PRICING_DUPLICATE_EFFECTIVE_FROM);
    expect(result.message.toLowerCase()).toContain("select it");
    expect(result.message.toLowerCase()).toContain("choose a different date");
  });

  it("maps a data-window coverage phrase to the blocked copy with ERROR tone", () => {
    const result = mapPricingSaveError(DATA_WINDOW_SAVE_RAW);
    expect(result).toEqual({ tone: "error", message: PRICING_DATA_WINDOW_BLOCKED });
  });

  it("maps the delete-call-site data-window phrase to the same blocked copy with ERROR tone", () => {
    const result = mapPricingSaveError(DATA_WINDOW_DELETE_RAW);
    expect(result).toEqual({ tone: "error", message: PRICING_DATA_WINDOW_BLOCKED });
  });

  it("maps a missing-tier-set-id message to the already-deleted copy with ERROR tone", () => {
    const result = mapPricingSaveError(MISSING_TIER_SET_RAW);
    expect(result).toEqual({ tone: "error", message: PRICING_ALREADY_DELETED });
  });

  it.each(TIER_INTEGRITY_RAW_MESSAGES)(
    "maps tier-integrity violation %j to the contiguity copy with ERROR tone",
    (raw) => {
      const result = mapPricingSaveError(raw);
      expect(result).toEqual({ tone: "error", message: PRICING_TIER_CONTIGUITY_ERROR });
    },
  );

  it("maps an unrecognised message to the generic copy with ERROR tone", () => {
    const result = mapPricingSaveError("permission denied for table pricing_tier_sets");
    expect(result).toEqual({ tone: "error", message: PRICING_GENERIC_SAVE_ERROR });
  });

  it("never echoes any substring of a raw message containing a table name", () => {
    const raw = 'ERROR: relation "pricing_tier_sets" does not exist';
    const result = mapPricingSaveError(raw);
    expect(result.message).not.toContain("pricing_tier_sets");
  });

  it("is total: every input maps to one of the exported constants", () => {
    const inputs = [
      EFFECTIVE_FROM_COLLISION_RAW,
      DATA_WINDOW_SAVE_RAW,
      DATA_WINDOW_DELETE_RAW,
      MISSING_TIER_SET_RAW,
      ...TIER_INTEGRITY_RAW_MESSAGES,
      "",
      "some entirely unrelated Postgres error",
    ];
    for (const raw of inputs) {
      const result = mapPricingSaveError(raw);
      expect(ALL_SAVE_CONSTANTS).toContain(result.message);
    }
  });
});

describe("mapPricingDeleteError", () => {
  it("maps a data-window coverage phrase to the blocked copy with ERROR tone (D-19 non-regression: untouched wording and tone)", () => {
    const result = mapPricingDeleteError(DATA_WINDOW_DELETE_RAW);
    expect(result).toEqual({ tone: "error", message: PRICING_DATA_WINDOW_BLOCKED });
  });

  it("maps the save-call-site data-window phrase to the same blocked copy with ERROR tone", () => {
    const result = mapPricingDeleteError(DATA_WINDOW_SAVE_RAW);
    expect(result).toEqual({ tone: "error", message: PRICING_DATA_WINDOW_BLOCKED });
  });

  it("maps a missing-tier-set-id message to the already-deleted copy with ERROR tone", () => {
    const result = mapPricingDeleteError(MISSING_TIER_SET_RAW);
    expect(result).toEqual({ tone: "error", message: PRICING_ALREADY_DELETED });
  });

  it("maps an unrecognised message to the generic delete copy with ERROR tone", () => {
    const result = mapPricingDeleteError("connection reset by peer");
    expect(result).toEqual({ tone: "error", message: PRICING_GENERIC_DELETE_ERROR });
  });

  it("never echoes any substring of a raw message containing a constraint name", () => {
    const raw = 'violates check constraint "pricing_tier_sets_data_window_check"';
    const result = mapPricingDeleteError(raw);
    expect(result.message).not.toContain("pricing_tier_sets_data_window_check");
  });

  it("is total: every input maps to one of the exported constants", () => {
    const inputs = [
      DATA_WINDOW_SAVE_RAW,
      DATA_WINDOW_DELETE_RAW,
      MISSING_TIER_SET_RAW,
      "",
      "some entirely unrelated Postgres error",
    ];
    for (const raw of inputs) {
      const result = mapPricingDeleteError(raw);
      expect(ALL_DELETE_CONSTANTS).toContain(result.message);
    }
  });
});
