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

  it("never returns null and never returns a non-null supersedes for an edit", () => {
    const mode: TierSetSaveMode = {
      kind: "edit",
      id: "msa",
      effectiveFrom: "2026-08-13",
    };
    const existing = [
      { id: "msa", effectiveFrom: "2026-08-13" },
      { id: "other", effectiveFrom: "2026-01-01" },
    ];
    const result = resolveSaveImpact(mode, "2026-08-20", existing);
    expect(result).not.toBeNull();
    expect(result?.supersedes).toBeNull();
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
});
