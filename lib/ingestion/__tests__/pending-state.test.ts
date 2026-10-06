import { describe, expect, it } from "vitest";

import {
  BACKGROUND_FUNCTION_CEILING_SECONDS,
  MAX_PROCESSING_ATTEMPTS,
  PROCESSING_LEASE_SECONDS,
  STUCK_PENDING_AFTER_HOURS,
  SWEEPABLE_AFTER_MINUTES,
  isSweepable,
  resolvePendingState,
  type PendingFileFacts,
} from "../pending-state";

/**
 * Pins the two live facts Phase 13 is built on: the lease, and the
 * thresholds it is measured against. Every boundary here must agree with
 * `fn_try_claim_ingested_file`'s own strictly-less-than comparison
 * (supabase/migrations/0049_ingest_lease_window_for_background_functions.sql)
 * — a drifted boundary is the one way this design could let two writers
 * believe they each hold the claim.
 */

const NOW = new Date("2026-10-05T12:00:00.000Z");

function minus(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Netlify's documented background-function invocation-retry delay: a
 * failed invocation is retried after one minute, then two minutes after
 * that — three minutes (180s) can elapse before a legitimate attempt is
 * even running. [CITED: Netlify background-functions documentation, the
 * same source `BACKGROUND_FUNCTION_CEILING_SECONDS`'s doc comment cites.]
 * Not exported from `pending-state.ts` itself — it is a platform fact
 * used only to state this one test's margin requirement, not a threshold
 * the module's own logic reads.
 */
const NETLIFY_INVOCATION_RETRY_DELAY_SECONDS = 60 + 2 * 60;

function facts(overrides: Partial<PendingFileFacts>): PendingFileFacts {
  return {
    status: "pending",
    uploadedAt: minus(30 * SECOND),
    processingStartedAt: null,
    processingAttempts: 0,
    ...overrides,
  };
}

describe("constants — the ordering that keeps the design coherent", () => {
  it("the lease window is strictly greater than the background-function ceiling", () => {
    expect(PROCESSING_LEASE_SECONDS).toBeGreaterThan(
      BACKGROUND_FUNCTION_CEILING_SECONDS,
    );
  });

  it("the lease window exceeds the ceiling by at least the platform's documented invocation-retry delay, so a delayed invocation that starts late still holds a live lease when it finishes", () => {
    const marginSeconds =
      PROCESSING_LEASE_SECONDS - BACKGROUND_FUNCTION_CEILING_SECONDS;
    expect(marginSeconds).toBeGreaterThanOrEqual(
      NETLIFY_INVOCATION_RETRY_DELAY_SECONDS,
    );
  });

  it("the sweepable age is strictly greater than the lease window", () => {
    const sweepableSeconds = SWEEPABLE_AFTER_MINUTES * 60;
    expect(sweepableSeconds).toBeGreaterThan(PROCESSING_LEASE_SECONDS);
  });

  it("the sweepable age is strictly greater than the background-function ceiling", () => {
    const sweepableSeconds = SWEEPABLE_AFTER_MINUTES * 60;
    expect(sweepableSeconds).toBeGreaterThan(
      BACKGROUND_FUNCTION_CEILING_SECONDS,
    );
  });

  it("the stuck age is strictly greater than the sweepable age", () => {
    const sweepableSeconds = SWEEPABLE_AFTER_MINUTES * 60;
    const stuckSeconds = STUCK_PENDING_AFTER_HOURS * 3600;
    expect(stuckSeconds).toBeGreaterThan(sweepableSeconds);
  });

  it("the stuck age exceeds the whole worst-case retry saga: the attempt cap multiplied by the lease window is comfortably shorter than the stuck threshold", () => {
    const worstCaseRetrySagaSeconds =
      MAX_PROCESSING_ATTEMPTS * PROCESSING_LEASE_SECONDS;
    const stuckSeconds = STUCK_PENDING_AFTER_HOURS * 3600;
    expect(worstCaseRetrySagaSeconds).toBeLessThan(stuckSeconds);
  });

  it("exports every threshold as a plain number", () => {
    expect(typeof BACKGROUND_FUNCTION_CEILING_SECONDS).toBe("number");
    expect(typeof PROCESSING_LEASE_SECONDS).toBe("number");
    expect(typeof SWEEPABLE_AFTER_MINUTES).toBe("number");
    expect(typeof STUCK_PENDING_AFTER_HOURS).toBe("number");
    expect(typeof MAX_PROCESSING_ATTEMPTS).toBe("number");
  });
});

describe("resolvePendingState — non-pending rows have no pending state", () => {
  it("returns null for status 'done'", () => {
    expect(resolvePendingState(facts({ status: "done" }), NOW)).toBeNull();
  });

  it("returns null for status 'failed'", () => {
    expect(resolvePendingState(facts({ status: "failed" }), NOW)).toBeNull();
  });

  it("returns null for the 'rejected' sentinel string", () => {
    expect(resolvePendingState(facts({ status: "rejected" }), NOW)).toBeNull();
  });
});

describe("resolvePendingState — a pending row's age and lease", () => {
  it("a row uploaded 30 seconds ago with a null lease is 'processing'", () => {
    expect(
      resolvePendingState(
        facts({ uploadedAt: minus(30 * SECOND), processingStartedAt: null }),
        NOW,
      ),
    ).toBe("processing");
  });

  it("a row uploaded 3 days ago with a null lease is 'stuck'", () => {
    expect(
      resolvePendingState(
        facts({ uploadedAt: minus(3 * DAY), processingStartedAt: null }),
        NOW,
      ),
    ).toBe("stuck");
  });

  it("a row uploaded 3 days ago whose lease was taken 10 seconds ago is 'processing' — a live lease wins over age", () => {
    expect(
      resolvePendingState(
        facts({
          uploadedAt: minus(3 * DAY),
          processingStartedAt: minus(10 * SECOND),
        }),
        NOW,
      ),
    ).toBe("processing");
  });

  it("a row uploaded 3 days ago whose lease was taken 20 minutes ago is 'stuck' — the lease is long expired, so the age rule applies again", () => {
    expect(
      resolvePendingState(
        facts({
          uploadedAt: minus(3 * DAY),
          processingStartedAt: minus(20 * MINUTE),
        }),
        NOW,
      ),
    ).toBe("stuck");
  });

  it("an age of exactly STUCK_PENDING_AFTER_HOURS with no live lease is 'stuck'", () => {
    expect(
      resolvePendingState(
        facts({
          uploadedAt: minus(STUCK_PENDING_AFTER_HOURS * HOUR),
          processingStartedAt: null,
        }),
        NOW,
      ),
    ).toBe("stuck");
  });

  it("one second under STUCK_PENDING_AFTER_HOURS with no live lease is 'processing'", () => {
    expect(
      resolvePendingState(
        facts({
          uploadedAt: minus(STUCK_PENDING_AFTER_HOURS * HOUR - SECOND),
          processingStartedAt: null,
        }),
        NOW,
      ),
    ).toBe("processing");
  });

  it("a lease exactly PROCESSING_LEASE_SECONDS old is NOT live — the reclaim window is inclusive at its far edge, matching the SQL's strictly-less-than comparison", () => {
    // Old enough that, were the lease live, this would read 'processing';
    // since the lease is exactly at the boundary (not live), and the row is
    // also past the stuck threshold, it must read 'stuck'.
    expect(
      resolvePendingState(
        facts({
          uploadedAt: minus(3 * DAY),
          processingStartedAt: minus(PROCESSING_LEASE_SECONDS * SECOND),
        }),
        NOW,
      ),
    ).toBe("stuck");
  });

  it("a lease taken exactly BACKGROUND_FUNCTION_CEILING_SECONDS worth of seconds ago is still live — a legitimate attempt running right up to the platform ceiling still holds its claim", () => {
    expect(
      resolvePendingState(
        facts({
          uploadedAt: minus(3 * DAY),
          processingStartedAt: minus(
            BACKGROUND_FUNCTION_CEILING_SECONDS * SECOND,
          ),
        }),
        NOW,
      ),
    ).toBe("processing");
  });
});

describe("isSweepable", () => {
  it("a pending row 30 seconds old is NOT sweepable — a first attempt is plausibly still in flight", () => {
    expect(isSweepable(facts({ uploadedAt: minus(30 * SECOND) }), NOW)).toBe(
      false,
    );
  });

  it("a pending row 30 minutes old with no live lease IS sweepable", () => {
    expect(
      isSweepable(
        facts({ uploadedAt: minus(30 * MINUTE), processingStartedAt: null }),
        NOW,
      ),
    ).toBe(true);
  });

  it("a pending row 30 minutes old with a lease taken 10 seconds ago is NOT sweepable", () => {
    expect(
      isSweepable(
        facts({
          uploadedAt: minus(30 * MINUTE),
          processingStartedAt: minus(10 * SECOND),
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it("a done row is never sweepable at any age", () => {
    expect(
      isSweepable(
        facts({ status: "done", uploadedAt: minus(30 * DAY), processingStartedAt: null }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe("isSweepable — the attempt cap (MAX_PROCESSING_ATTEMPTS)", () => {
  it("a row with no lease, old enough, and attempts below the cap is sweepable, exactly as today", () => {
    expect(
      isSweepable(
        facts({
          uploadedAt: minus(DAY),
          processingStartedAt: null,
          processingAttempts: MAX_PROCESSING_ATTEMPTS - 1,
        }),
        NOW,
      ),
    ).toBe(true);
  });

  it("an otherwise-identical row with attempts equal to the cap is NOT sweepable", () => {
    expect(
      isSweepable(
        facts({
          uploadedAt: minus(DAY),
          processingStartedAt: null,
          processingAttempts: MAX_PROCESSING_ATTEMPTS,
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it("a row with attempts above the cap is NOT sweepable", () => {
    expect(
      isSweepable(
        facts({
          uploadedAt: minus(DAY),
          processingStartedAt: null,
          processingAttempts: MAX_PROCESSING_ATTEMPTS + 1,
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it("the cap is checked independently of the lease — a capped row with a live lease is still not sweepable", () => {
    expect(
      isSweepable(
        facts({
          uploadedAt: minus(DAY),
          processingStartedAt: minus(10 * SECOND),
          processingAttempts: MAX_PROCESSING_ATTEMPTS,
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it("the cap is checked independently of the lease — a capped row with no lease is also not sweepable", () => {
    expect(
      isSweepable(
        facts({
          uploadedAt: minus(DAY),
          processingStartedAt: null,
          processingAttempts: MAX_PROCESSING_ATTEMPTS,
        }),
        NOW,
      ),
    ).toBe(false);
  });

  it("resolvePendingState is unchanged by the cap — a capped row past the stuck age still resolves as stuck, which is the whole point: the cap stops the retrying, not the reporting", () => {
    expect(
      resolvePendingState(
        facts({
          uploadedAt: minus(3 * DAY),
          processingStartedAt: null,
          processingAttempts: MAX_PROCESSING_ATTEMPTS + 5,
        }),
        NOW,
      ),
    ).toBe("stuck");
  });
});
