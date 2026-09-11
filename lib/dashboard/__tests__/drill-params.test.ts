import { describe, expect, it } from "vitest";

import {
  parseDrillParams,
  serializeDrillParams,
  type DrillFilter,
} from "../drill-params";

describe("parseDrillParams", () => {
  it("returns null when no `drill` key is present", () => {
    expect(parseDrillParams({})).toBeNull();
    expect(parseDrillParams({ date: "2026-08-14" })).toBeNull();
  });

  it("returns null when `drill` is an unrecognised entity", () => {
    expect(parseDrillParams({ drill: "discrepancy" })).toBeNull();
    expect(parseDrillParams({ drill: "DROP TABLE verifications;" })).toBeNull();
    expect(parseDrillParams({ drill: "" })).toBeNull();
  });

  it("accepts each of the three whitelisted entities", () => {
    expect(parseDrillParams({ drill: "verification" })).toEqual({
      drill: "verification",
    });
    expect(parseDrillParams({ drill: "revenue-tier" })).toEqual({
      drill: "revenue-tier",
    });
    expect(parseDrillParams({ drill: "sla-breach" })).toEqual({
      drill: "sla-breach",
    });
  });

  it("parses drill=verification&date=2026-08-14&authenticated=false into a typed filter", () => {
    const result = parseDrillParams({
      drill: "verification",
      date: "2026-08-14",
      authenticated: "false",
    });

    expect(result).toEqual({
      drill: "verification",
      date: "2026-08-14",
      authenticated: false,
    });
  });

  it("coerces authenticated=true into a boolean", () => {
    const result = parseDrillParams({ drill: "verification", authenticated: "true" });
    expect(result).toEqual({ drill: "verification", authenticated: true });
  });

  it("coerces tierOrder into an integer", () => {
    const result = parseDrillParams({ drill: "revenue-tier", tierOrder: "2" });
    expect(result).toEqual({ drill: "revenue-tier", tierOrder: 2 });
  });

  it("ignores an unparseable tierOrder rather than passing through a garbage string", () => {
    const result = parseDrillParams({ drill: "revenue-tier", tierOrder: "not-a-number" });
    expect(result).toEqual({ drill: "revenue-tier" });
  });

  it("drops unknown filter keys — only whitelisted keys survive", () => {
    const result = parseDrillParams({
      drill: "verification",
      date: "2026-08-14",
      // Not in the whitelist — must be dropped, never passed to a query builder.
      injected: "'; DROP TABLE verifications; --",
      externalCardReference: "should-not-survive",
    });

    expect(result).toEqual({ drill: "verification", date: "2026-08-14" });
    expect(result).not.toHaveProperty("injected");
    expect(result).not.toHaveProperty("externalCardReference");
  });

  it("drops a malformed `date` (non-ISO string) rather than passing it through", () => {
    const result = parseDrillParams({ drill: "sla-breach", date: "nope" });
    expect(result).toEqual({ drill: "sla-breach" });
    expect(result).not.toHaveProperty("date");
  });

  it("drops a calendar-invalid `date` (e.g. month 13)", () => {
    const result = parseDrillParams({ drill: "sla-breach", date: "2026-13-99" });
    expect(result).toEqual({ drill: "sla-breach" });
    expect(result).not.toHaveProperty("date");
  });

  it("accepts a well-formed ISO `date`", () => {
    const result = parseDrillParams({ drill: "sla-breach", date: "2026-08-14" });
    expect(result).toEqual({ drill: "sla-breach", date: "2026-08-14" });
  });

  it("takes the first value when a param is an array (repeated query key)", () => {
    const result = parseDrillParams({ drill: ["verification", "sla-breach"] });
    expect(result).toEqual({ drill: "verification" });
  });

  it("accepts each of the four new alignment drill entities (Phase 6, ALIGN-04/ALIGN-07)", () => {
    expect(parseDrillParams({ drill: "alignment-enrolled" })).toEqual({
      drill: "alignment-enrolled",
    });
    expect(parseDrillParams({ drill: "alignment-unenrolled" })).toEqual({
      drill: "alignment-unenrolled",
    });
    expect(parseDrillParams({ drill: "alignment-live-cards" })).toEqual({
      drill: "alignment-live-cards",
    });
    expect(parseDrillParams({ drill: "alignment-volume" })).toEqual({
      drill: "alignment-volume",
    });
  });

  it("parses drill=alignment-volume&date=2026-08-14 into a typed filter (level-two day)", () => {
    const result = parseDrillParams({ drill: "alignment-volume", date: "2026-08-14" });
    expect(result).toEqual({ drill: "alignment-volume", date: "2026-08-14" });
  });

  it("still rejects a calendar-invalid date (month 13) for a new alignment entity", () => {
    const result = parseDrillParams({ drill: "alignment-live-cards", date: "2026-13-99" });
    expect(result).toEqual({ drill: "alignment-live-cards" });
    expect(result).not.toHaveProperty("date");
  });

  it("drops unknown filter keys for a new alignment entity — only whitelisted keys survive", () => {
    const result = parseDrillParams({
      drill: "alignment-enrolled",
      date: "2026-08-14",
      injected: "'; DROP TABLE apigee_calls; --",
    });
    expect(result).toEqual({ drill: "alignment-enrolled", date: "2026-08-14" });
    expect(result).not.toHaveProperty("injected");
  });
});

describe("serializeDrillParams", () => {
  it("round-trips a full DrillFilter back to string params", () => {
    const filter: DrillFilter = {
      drill: "verification",
      date: "2026-08-14",
      authenticated: false,
    };

    const serialized = serializeDrillParams(filter);
    expect(serialized).toEqual({
      drill: "verification",
      date: "2026-08-14",
      authenticated: "false",
    });

    const reparsed = parseDrillParams(serialized);
    expect(reparsed).toEqual(filter);
  });

  it("round-trips a minimal DrillFilter (drill only)", () => {
    const filter: DrillFilter = { drill: "sla-breach" };
    const serialized = serializeDrillParams(filter);
    expect(serialized).toEqual({ drill: "sla-breach" });
    expect(parseDrillParams(serialized)).toEqual(filter);
  });

  it("round-trips a revenue-tier filter with tierOrder", () => {
    const filter: DrillFilter = { drill: "revenue-tier", date: "2026-08-14", tierOrder: 1 };
    const serialized = serializeDrillParams(filter);
    expect(serialized).toEqual({
      drill: "revenue-tier",
      date: "2026-08-14",
      tierOrder: "1",
    });
    expect(parseDrillParams(serialized)).toEqual(filter);
  });

  it("round-trips each of the four new alignment drill entities, with and without a level-two date", () => {
    const entities = [
      "alignment-enrolled",
      "alignment-unenrolled",
      "alignment-live-cards",
      "alignment-volume",
    ] as const;

    for (const drill of entities) {
      const levelOne: DrillFilter = { drill };
      expect(parseDrillParams(serializeDrillParams(levelOne))).toEqual(levelOne);

      const levelTwo: DrillFilter = { drill, date: "2026-08-14" };
      expect(parseDrillParams(serializeDrillParams(levelTwo))).toEqual(levelTwo);
    }
  });
});
