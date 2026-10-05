import { describe, expect, it } from "vitest";

import {
  PROBE_DEFAULT_SECONDS,
  PROBE_LADDER,
  PROBE_MAX_SECONDS,
  clampProbeSeconds,
} from "../function-ceiling";

/**
 * Pins the clamp that keeps the ceiling probe
 * (app/api/diagnostics/function-ceiling/route.ts) from ever being asked to
 * hold a connection open indefinitely, and the ladder a human walks up when
 * measuring this site's real ceiling (this plan's Task 3).
 */

describe("clampProbeSeconds", () => {
  it("returns PROBE_DEFAULT_SECONDS for a null input", () => {
    expect(clampProbeSeconds(null)).toBe(PROBE_DEFAULT_SECONDS);
  });

  it("returns PROBE_DEFAULT_SECONDS for an empty-string input", () => {
    expect(clampProbeSeconds("")).toBe(PROBE_DEFAULT_SECONDS);
    expect(clampProbeSeconds("   ")).toBe(PROBE_DEFAULT_SECONDS);
  });

  it("returns PROBE_DEFAULT_SECONDS for a non-numeric string, never NaN", () => {
    const result = clampProbeSeconds("banana");
    expect(result).toBe(PROBE_DEFAULT_SECONDS);
    expect(Number.isNaN(result)).toBe(false);
  });

  it("returns 1 (the floor) for '0'", () => {
    expect(clampProbeSeconds("0")).toBe(1);
  });

  it("returns 1 (the floor) for a negative value", () => {
    expect(clampProbeSeconds("-5")).toBe(1);
  });

  it("returns PROBE_MAX_SECONDS exactly for a value above it", () => {
    expect(clampProbeSeconds("1000")).toBe(PROBE_MAX_SECONDS);
  });

  it("truncates a fractional value to a whole number of seconds", () => {
    expect(clampProbeSeconds("25.7")).toBe(25);
  });

  it("passes an in-range whole value through unchanged", () => {
    expect(clampProbeSeconds("26")).toBe(26);
  });

  it("PROBE_MAX_SECONDS is strictly below the route's declared maxDuration (60) — the probe can never itself be the thing that exceeds the declaration it is measuring", () => {
    expect(PROBE_MAX_SECONDS).toBeLessThan(60);
  });
});

describe("PROBE_LADDER", () => {
  it("is strictly ascending", () => {
    for (let i = 1; i < PROBE_LADDER.length; i++) {
      expect(PROBE_LADDER[i]).toBeGreaterThan(PROBE_LADDER[i - 1]);
    }
  });

  it("starts at or below 10", () => {
    expect(PROBE_LADDER[0]).toBeLessThanOrEqual(10);
  });

  it("includes 26 — the number this project actually measured on 2026-10-05", () => {
    expect(PROBE_LADDER).toContain(26);
  });

  it("excludes 60 — it exceeds PROBE_MAX_SECONDS", () => {
    expect(PROBE_LADDER).not.toContain(60);
  });

  it("every entry is at or below PROBE_MAX_SECONDS", () => {
    for (const rung of PROBE_LADDER) {
      expect(rung).toBeLessThanOrEqual(PROBE_MAX_SECONDS);
    }
  });
});
