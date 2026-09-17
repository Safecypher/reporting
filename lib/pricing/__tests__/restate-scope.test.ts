import { describe, expect, it } from "vitest";
import { resolveSaveImpact, type TierSetSaveMode } from "../restate-scope";

// G-05-5 (05-07): the live incident was a CREATE that landed on top of an
// already-active tier set (the signed TSYS MSA ladder, effective
// 2026-08-13) while the create path was exempt from any restate check. The
// gate implemented here is STRUCTURAL — does an existing set already price
// the proposed date — not activity-count-based, because the incident's
// stray set was effective 2026-09-10 while ingested data ran only to
// 2026-09-08: an activity-day gate would have returned zero and stayed
// silent, exactly as it did live. See 05-07-PLAN.md objective.

const CREATE: TierSetSaveMode = { kind: "create" };

describe("resolveSaveImpact — create mode", () => {
  it("returns null when there are no existing tier sets (genuinely first set)", () => {
    expect(resolveSaveImpact(CREATE, "2026-08-13", [])).toBeNull();
  });

  it("returns null when every existing set is strictly later than the proposed date", () => {
    const existing = [{ id: "a", effectiveFrom: "2026-10-01" }];
    expect(resolveSaveImpact(CREATE, "2026-09-10", existing)).toBeNull();
  });

  it("gates the live incident: one earlier active set, open-ended supersede", () => {
    const existing = [{ id: "msa", effectiveFrom: "2026-08-13" }];
    expect(resolveSaveImpact(CREATE, "2026-09-10", existing)).toEqual({
      from: "2026-09-10",
      through: null,
      supersedes: "2026-08-13",
    });
  });

  it("caps the affected range at the day before the next later set", () => {
    const existing = [
      { id: "msa", effectiveFrom: "2026-08-13" },
      { id: "next", effectiveFrom: "2027-01-01" },
    ];
    expect(resolveSaveImpact(CREATE, "2026-09-10", existing)).toEqual({
      from: "2026-09-10",
      through: "2026-12-31",
      supersedes: "2026-08-13",
    });
  });

  it("decrements within the same month (not month arithmetic)", () => {
    const existing = [
      { id: "msa", effectiveFrom: "2026-08-13" },
      { id: "next", effectiveFrom: "2026-10-01" },
    ];
    expect(resolveSaveImpact(CREATE, "2026-09-30", existing)).toEqual({
      from: "2026-09-30",
      through: "2026-09-30",
      supersedes: "2026-08-13",
    });
  });

  it("returns null (never a negative range) when the only existing set precedes nothing", () => {
    const existing = [{ id: "future", effectiveFrom: "2027-01-01" }];
    const result = resolveSaveImpact(CREATE, "2026-12-31", existing);
    expect(result).toBeNull();
  });

  it("decrements correctly across a month boundary", () => {
    const existing = [
      { id: "earlier", effectiveFrom: "2026-01-01" },
      { id: "later", effectiveFrom: "2026-03-01" },
    ];
    expect(resolveSaveImpact(CREATE, "2026-02-28", existing)?.through).toBe(
      "2026-02-28",
    );
  });

  it("decrements correctly across a year boundary", () => {
    const existing = [
      { id: "earlier", effectiveFrom: "2026-01-01" },
      { id: "later", effectiveFrom: "2027-01-01" },
    ];
    expect(resolveSaveImpact(CREATE, "2026-12-31", existing)?.through).toBe(
      "2026-12-31",
    );
  });

  it("returns non-null when the proposed date exactly matches an existing set's effective_from", () => {
    const existing = [{ id: "msa", effectiveFrom: "2026-08-13" }];
    const result = resolveSaveImpact(CREATE, "2026-08-13", existing);
    // The resolver must not pretend a same-day collision is harmless — the
    // server UNIQUE constraint rejects it, but the UI gate must still fire.
    expect(result).not.toBeNull();
  });

  it("supersedes the LATEST existing set at or before the proposed date", () => {
    const existing = [
      { id: "msa", effectiveFrom: "2026-08-13" },
      { id: "amendment", effectiveFrom: "2026-09-01" },
    ];
    expect(resolveSaveImpact(CREATE, "2026-09-10", existing)?.supersedes).toBe(
      "2026-09-01",
    );
  });
});

describe("resolveSaveImpact — edit mode (D-18/P-04 non-regression)", () => {
  it("returns the current date unchanged when the proposed date equals the current date", () => {
    const mode: TierSetSaveMode = {
      kind: "edit",
      id: "msa",
      effectiveFrom: "2026-08-13",
    };
    expect(resolveSaveImpact(mode, "2026-08-13", [])).toEqual({
      from: "2026-08-13",
      through: null,
      supersedes: null,
    });
  });

  it("returns the earlier date when the proposed date moves later", () => {
    const mode: TierSetSaveMode = {
      kind: "edit",
      id: "msa",
      effectiveFrom: "2026-08-13",
    };
    expect(resolveSaveImpact(mode, "2026-09-01", [])).toEqual({
      from: "2026-08-13",
      through: null,
      supersedes: null,
    });
  });

  it("returns the earlier date when the proposed date moves earlier (backdate)", () => {
    const mode: TierSetSaveMode = {
      kind: "edit",
      id: "msa",
      effectiveFrom: "2026-09-01",
    };
    expect(resolveSaveImpact(mode, "2026-08-13", [])).toEqual({
      from: "2026-08-13",
      through: null,
      supersedes: null,
    });
  });

  it("does not displace a set that is earlier than the edited set's own current date, even after moving later", () => {
    // The only other set (2026-08-13) already sat BEFORE the edited set's
    // current date (2026-09-01) — it was never governing the days the move
    // crosses into, so this is not a displacement.
    const mode: TierSetSaveMode = {
      kind: "edit",
      id: "msa",
      effectiveFrom: "2026-09-01",
    };
    const existing = [{ id: "a", effectiveFrom: "2026-08-13" }];
    expect(resolveSaveImpact(mode, "2026-10-01", existing)).toEqual({
      from: "2026-09-01",
      through: null,
      supersedes: null,
    });
  });

  it("does not displace a set when backdating into territory no other set prices", () => {
    const mode: TierSetSaveMode = {
      kind: "edit",
      id: "msa",
      effectiveFrom: "2026-10-01",
    };
    const existing = [{ id: "c", effectiveFrom: "2027-01-01" }];
    expect(resolveSaveImpact(mode, "2026-09-01", existing)).toEqual({
      from: "2026-09-01",
      through: null,
      supersedes: null,
    });
  });

  it("excludes the set being edited from the supersede scan even if passed in the existing list", () => {
    const mode: TierSetSaveMode = {
      kind: "edit",
      id: "msa",
      effectiveFrom: "2026-08-13",
    };
    // The edited set's own row is present in `existing` (caller did not
    // filter it out) — the edit branch must still never report it (or any
    // other set) as a supersede target.
    const existing = [{ id: "msa", effectiveFrom: "2026-08-13" }];
    expect(resolveSaveImpact(mode, "2026-08-13", existing)?.supersedes).toBeNull();
  });

  it("an edit always returns a defined impact — never null — whether or not it displaces another set", () => {
    const displacingMode: TierSetSaveMode = {
      kind: "edit",
      id: "e",
      effectiveFrom: "2026-08-13",
    };
    const displacingExisting = [{ id: "a", effectiveFrom: "2026-09-01" }];
    expect(resolveSaveImpact(displacingMode, "2026-09-15", displacingExisting)).not.toBeNull();

    const nonDisplacingMode: TierSetSaveMode = {
      kind: "edit",
      id: "e",
      effectiveFrom: "2026-08-13",
    };
    expect(resolveSaveImpact(nonDisplacingMode, "2026-08-13", [])).not.toBeNull();
  });
});

// G-05-CR01 (code review CR-01, closing 05-UAT.md's gap of the same id): an
// edit that moves a tier set's effective_from across another tier set's date
// silently reassigns pricing authority for the days between them, because
// v_revenue_tier_set_by_day (supabase/migrations/0012_v_revenue.sql) resolves
// each day's governing tier set purely by relative effective_from ordering —
// "this row already covered that day before the edit" is not part of that
// rule. Notation below: E is the edited set (id "e"), c is its CURRENT
// effective date, p is its PROPOSED effective date, and every other set is
// listed with its own id. The obvious single-filter predicate the code
// review sketched (`effectiveFrom <= p && effectiveFrom > c`) is EMPTY for
// every backdate (p < c makes the two bounds contradictory) — the cases
// below cover BOTH crossing directions precisely because that predicate only
// covers one of them.
describe("resolveSaveImpact — edit mode displacement across another tier set (G-05-CR01/CR-01)", () => {
  it("moving later across one set reports that set as displaced (the code review's own scenario)", () => {
    const mode: TierSetSaveMode = { kind: "edit", id: "e", effectiveFrom: "2026-08-13" };
    const existing = [{ id: "a", effectiveFrom: "2026-09-01" }];
    expect(resolveSaveImpact(mode, "2026-09-15", existing)).toEqual({
      from: "2026-08-13",
      through: null,
      supersedes: "2026-09-01",
    });
  });

  it("moving later across one set caps the affected range at the day before the next later set", () => {
    const mode: TierSetSaveMode = { kind: "edit", id: "e", effectiveFrom: "2026-08-13" };
    const existing = [
      { id: "a", effectiveFrom: "2026-09-01" },
      { id: "b", effectiveFrom: "2026-10-01" },
    ];
    expect(resolveSaveImpact(mode, "2026-09-15", existing)).toEqual({
      from: "2026-08-13",
      through: "2026-09-30",
      supersedes: "2026-09-01",
    });
  });

  it("moving later across two sets reports the LATEST crossed one", () => {
    const mode: TierSetSaveMode = { kind: "edit", id: "e", effectiveFrom: "2026-08-13" };
    const existing = [
      { id: "a", effectiveFrom: "2026-09-01" },
      { id: "a2", effectiveFrom: "2026-09-10" },
    ];
    expect(resolveSaveImpact(mode, "2026-09-15", existing)?.supersedes).toBe("2026-09-10");
  });

  it("moving EARLIER (backdating) across a set reports that set as displaced", () => {
    const mode: TierSetSaveMode = { kind: "edit", id: "e", effectiveFrom: "2026-10-01" };
    const existing = [{ id: "a", effectiveFrom: "2026-08-13" }];
    expect(resolveSaveImpact(mode, "2026-09-01", existing)).toEqual({
      from: "2026-09-01",
      through: null,
      supersedes: "2026-08-13",
    });
  });

  it("moving earlier caps the affected range at the day before the next later set, proving the year-boundary decrement", () => {
    const mode: TierSetSaveMode = { kind: "edit", id: "e", effectiveFrom: "2026-10-01" };
    const existing = [
      { id: "a", effectiveFrom: "2026-08-13" },
      { id: "c", effectiveFrom: "2027-01-01" },
    ];
    expect(resolveSaveImpact(mode, "2026-09-01", existing)).toEqual({
      from: "2026-09-01",
      through: "2026-12-31",
      supersedes: "2026-08-13",
    });
  });

  it("reports a displacement even when the proposed date lands exactly on another set's date", () => {
    // The server UNIQUE constraint rejects this write outright, but the
    // resolver must not pretend the collision is harmless — same stance the
    // create branch already takes for an exact-date collision.
    const mode: TierSetSaveMode = { kind: "edit", id: "e", effectiveFrom: "2026-08-13" };
    const existing = [{ id: "a", effectiveFrom: "2026-09-01" }];
    const result = resolveSaveImpact(mode, "2026-09-01", existing);
    expect(result?.supersedes).toBe("2026-09-01");
  });

  it("never reports the edited set's own row as displaced, even when passed alongside a genuinely different set", () => {
    const mode: TierSetSaveMode = { kind: "edit", id: "e", effectiveFrom: "2026-10-01" };
    const existing = [
      { id: "e", effectiveFrom: "2026-10-01" },
      { id: "a", effectiveFrom: "2026-08-13" },
    ];
    const result = resolveSaveImpact(mode, "2026-09-01", existing);
    expect(result?.supersedes).toBe("2026-08-13");
    expect(result?.supersedes).not.toBe("2026-10-01");
  });

  it("resolves a tie between two other sets sharing the same effective_from to that shared date", () => {
    const mode: TierSetSaveMode = { kind: "edit", id: "e", effectiveFrom: "2026-08-13" };
    const existing = [
      { id: "a", effectiveFrom: "2026-09-01" },
      { id: "b", effectiveFrom: "2026-09-01" },
    ];
    expect(resolveSaveImpact(mode, "2026-09-15", existing)?.supersedes).toBe("2026-09-01");
  });
});

// WR-08 (08-02, closing 05-REVIEW's round-4 triage): `atOrBeforeProposed`
// above only ever considers sets at-or-before the proposed date, so it can
// never see a set LATER than the proposed date — including the one that
// ends up permanently outranking the edited set for its own former future
// territory. The three-set worked example below is the review's own
// scenario: backdating across the earliest of two later sets correctly
// names the crossed one (supersedes), but silently hands the SECOND,
// further-out set every day from 2026-09-01 onward that the edited set
// exclusively owned before the move — forever, since nothing existed beyond
// it. `futureSupersededBy` is the new, distinct, second consequence.
describe("resolveSaveImpact — edit mode reports the far-future consequence too (WR-08)", () => {
  it("a three-set backdate names both the crossed set AND the set absorbing the edited set's future territory", () => {
    const mode: TierSetSaveMode = { kind: "edit", id: "e", effectiveFrom: "2026-09-01" };
    const existing = [
      { id: "x", effectiveFrom: "2026-07-01" },
      { id: "y", effectiveFrom: "2026-08-01" },
    ];
    // e currently owns 2026-09-01 onward, exclusively and forever (nothing
    // existing is later than it). Backdating to 2026-07-15 crosses x
    // (correctly reported as `supersedes`) but ALSO permanently surrenders
    // everything from 2026-08-01 onward — including every day from
    // 2026-09-01 that was e's own former exclusive territory — to y, which
    // the pre-fix resolver never named.
    expect(resolveSaveImpact(mode, "2026-07-15", existing)).toEqual({
      from: "2026-07-15",
      through: null,
      supersedes: "2026-07-01",
      futureSupersededBy: "2026-08-01",
    });
  });

  it("does not fire on a single-set backdate — the crossed set IS the far-future governor, nothing further out exists", () => {
    const mode: TierSetSaveMode = { kind: "edit", id: "e", effectiveFrom: "2026-10-01" };
    const existing = [{ id: "a", effectiveFrom: "2026-08-13" }];
    const result = resolveSaveImpact(mode, "2026-09-01", existing);
    expect(result).toEqual({
      from: "2026-09-01",
      through: null,
      supersedes: "2026-08-13",
    });
    expect(result?.futureSupersededBy).toBeUndefined();
  });

  it("does not fire on a forward move — a set later than the edited set's OLD date was already the permanent governor before the edit", () => {
    const mode: TierSetSaveMode = { kind: "edit", id: "e", effectiveFrom: "2026-08-13" };
    const existing = [
      { id: "a", effectiveFrom: "2026-09-01" },
      { id: "b", effectiveFrom: "2026-10-01" },
    ];
    const result = resolveSaveImpact(mode, "2026-09-15", existing);
    expect(result).toEqual({
      from: "2026-08-13",
      through: "2026-09-30",
      supersedes: "2026-09-01",
    });
    expect(result?.futureSupersededBy).toBeUndefined();
  });

  it("does not fire on an already-governed edit — no displacement at all, so no far-future consequence either", () => {
    const mode: TierSetSaveMode = { kind: "edit", id: "e", effectiveFrom: "2026-09-01" };
    const existing = [{ id: "a", effectiveFrom: "2026-08-13" }];
    const result = resolveSaveImpact(mode, "2026-10-01", existing);
    expect(result).toEqual({ from: "2026-09-01", through: null, supersedes: null });
    expect(result?.futureSupersededBy).toBeUndefined();
  });
});
