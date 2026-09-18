import { describe, expect, it } from "vitest";
import { resolveSaveImpact, type SaveImpact, type TierSetSaveMode } from "../restate-scope";
import {
  buildRestateDialogCopy,
  resolvePricingAuthorityMove,
  resolveRestateGate,
} from "../restate-gate";

// WR-08 (08-05, closing 08-REVIEW.md CR-01 / 08-VERIFICATION.md's WR-08 gap):
// the resolver-level `futureSupersededBy` field (08-02) shipped with zero
// downstream consumers. The submit gate keyed on `impact.supersedes !== null`
// alone, and that single-limb condition is reachable-around:
// `futureSupersededBy` can fire while `supersedes` is `null`, silently
// skipping the "ALWAYS confirm regardless of day count" guarantee
// (G-05-CR01) entirely. These tests feed REAL resolver output into the gate
// — never a hand-built impact object — to prove the wire, not the shape.

describe("resolveRestateGate — the silent-bypass regression (WR-08)", () => {
  it("the two-set backdate: resolveSaveImpact reports the far-future consequence with supersedes null", () => {
    const mode: TierSetSaveMode = { kind: "edit", id: "e", effectiveFrom: "2026-09-01" };
    const existing = [{ id: "y", effectiveFrom: "2026-08-01" }];
    const impact = resolveSaveImpact(mode, "2026-07-15", existing);

    expect(impact).toEqual({
      from: "2026-07-15",
      through: null,
      supersedes: null,
      futureSupersededBy: "2026-08-01",
    });
  });

  it("at ZERO affected days, still opens the confirmation — the whole point of this case", () => {
    const mode: TierSetSaveMode = { kind: "edit", id: "e", effectiveFrom: "2026-09-01" };
    const existing = [{ id: "y", effectiveFrom: "2026-08-01" }];
    const impact = resolveSaveImpact(mode, "2026-07-15", existing) as SaveImpact;

    const decision = resolveRestateGate("edit", impact, 0);

    expect(decision.kind).toBe("confirm");
    if (decision.kind !== "confirm") throw new Error("unreachable");
    expect(decision.variant).toBe("edit-supersede");
    expect(decision.move?.supersedes).toBeNull();
    expect(decision.move?.futureSupersededBy).toBe("2026-08-01");
  });

  it("at a NON-ZERO day count, still edit-supersede — never the plain edit variant", () => {
    const mode: TierSetSaveMode = { kind: "edit", id: "e", effectiveFrom: "2026-09-01" };
    const existing = [{ id: "y", effectiveFrom: "2026-08-01" }];
    const impact = resolveSaveImpact(mode, "2026-07-15", existing) as SaveImpact;

    const decision = resolveRestateGate("edit", impact, 12);

    expect(decision.kind).toBe("confirm");
    if (decision.kind !== "confirm") throw new Error("unreachable");
    expect(decision.variant).toBe("edit-supersede");
  });

  it("the 08-02 three-set worked example: both limbs fire together", () => {
    const mode: TierSetSaveMode = { kind: "edit", id: "e", effectiveFrom: "2026-09-01" };
    const existing = [
      { id: "x", effectiveFrom: "2026-07-01" },
      { id: "y", effectiveFrom: "2026-08-01" },
    ];
    const impact = resolveSaveImpact(mode, "2026-07-15", existing) as SaveImpact;

    const decision = resolveRestateGate("edit", impact, 3);

    expect(decision.kind).toBe("confirm");
    if (decision.kind !== "confirm") throw new Error("unreachable");
    expect(decision.variant).toBe("edit-supersede");
    expect(decision.move?.supersedes).toBe("2026-07-01");
    expect(decision.move?.futureSupersededBy).toBe("2026-08-01");
  });

  it("property: resolveRestateGate never returns save-immediately or the plain edit variant when futureSupersededBy is defined", () => {
    const fixtures: {
      mode: TierSetSaveMode;
      proposed: string;
      existing: { id: string; effectiveFrom: string }[];
    }[] = [
      {
        mode: { kind: "edit", id: "e", effectiveFrom: "2026-09-01" },
        proposed: "2026-07-15",
        existing: [{ id: "y", effectiveFrom: "2026-08-01" }],
      },
      {
        mode: { kind: "edit", id: "e", effectiveFrom: "2026-09-01" },
        proposed: "2026-07-15",
        existing: [
          { id: "x", effectiveFrom: "2026-07-01" },
          { id: "y", effectiveFrom: "2026-08-01" },
        ],
      },
    ];

    for (const { mode, proposed, existing } of fixtures) {
      const impact = resolveSaveImpact(mode, proposed, existing) as SaveImpact;
      expect(impact.futureSupersededBy).toBeDefined();

      for (const days of [0, 12]) {
        const decision = resolveRestateGate("edit", impact, days);
        expect(decision.kind).not.toBe("save-immediately");
        if (decision.kind === "confirm") {
          expect(decision.variant).not.toBe("edit");
        }
      }
    }
  });
});

describe("resolveRestateGate — no regression to what already works", () => {
  it("crossed-neighbour-only edit at zero days: still confirm, edit-supersede (G-05-CR01 unchanged)", () => {
    const mode: TierSetSaveMode = { kind: "edit", id: "e", effectiveFrom: "2026-10-01" };
    const existing = [{ id: "a", effectiveFrom: "2026-08-13" }];
    const impact = resolveSaveImpact(mode, "2026-09-01", existing) as SaveImpact;

    expect(impact.supersedes).toBe("2026-08-13");
    expect(impact.futureSupersededBy).toBeUndefined();

    const decision = resolveRestateGate("edit", impact, 0);
    expect(decision.kind).toBe("confirm");
    if (decision.kind !== "confirm") throw new Error("unreachable");
    expect(decision.variant).toBe("edit-supersede");
  });

  it("an edit with no authority movement at all: zero days saves immediately, non-zero opens the plain edit dialog", () => {
    const mode: TierSetSaveMode = { kind: "edit", id: "e", effectiveFrom: "2026-09-01" };
    const existing = [{ id: "a", effectiveFrom: "2026-08-13" }];
    const impact = resolveSaveImpact(mode, "2026-10-01", existing) as SaveImpact;

    expect(impact.supersedes).toBeNull();
    expect(impact.futureSupersededBy).toBeUndefined();

    const zeroDecision = resolveRestateGate("edit", impact, 0);
    expect(zeroDecision.kind).toBe("save-immediately");

    const fiveDecision = resolveRestateGate("edit", impact, 5);
    expect(fiveDecision.kind).toBe("confirm");
    if (fiveDecision.kind !== "confirm") throw new Error("unreachable");
    expect(fiveDecision.variant).toBe("edit");
    expect(fiveDecision.move).toBeNull();
  });

  it("create mode with a non-null impact: confirm, create-supersede, at both zero and non-zero day counts", () => {
    const existing = [{ id: "msa", effectiveFrom: "2026-08-13" }];
    const impact = resolveSaveImpact({ kind: "create" }, "2026-09-10", existing) as SaveImpact;

    for (const days of [0, 7]) {
      const decision = resolveRestateGate("create", impact, days);
      expect(decision.kind).toBe("confirm");
      if (decision.kind !== "confirm") throw new Error("unreachable");
      expect(decision.variant).toBe("create-supersede");
    }
  });

  it("a create never reports a far-future consequence — the create branch has no such concept", () => {
    const impact = resolveSaveImpact({ kind: "create" }, "2026-07-15", [
      { id: "y", effectiveFrom: "2026-08-01" },
    ]);
    expect(impact).toBeNull();
  });
});

describe("resolvePricingAuthorityMove", () => {
  it("returns null for a null impact", () => {
    expect(resolvePricingAuthorityMove(null)).toBeNull();
  });

  it("returns null when neither limb is present", () => {
    expect(
      resolvePricingAuthorityMove({ from: "2026-01-01", through: null, supersedes: null }),
    ).toBeNull();
  });

  it("normalises the optional futureSupersededBy field to null when absent", () => {
    const move = resolvePricingAuthorityMove({
      from: "2026-01-01",
      through: null,
      supersedes: "2026-01-01",
    });
    expect(move).toEqual({ supersedes: "2026-01-01", futureSupersededBy: null });
  });
});

describe("buildRestateDialogCopy — the disclosure itself, now machine-checkable", () => {
  it("edit-supersede, both limbs: body names BOTH dates as distinct sentences, title is the both-limbs title", () => {
    const copy = buildRestateDialogCopy({
      variant: "edit-supersede",
      days: 3,
      proposedEffectiveFrom: "2026-07-15",
      supersedes: "2026-07-01",
      futureSupersededBy: "2026-08-01",
    });

    expect(copy.title).toBe("Save changes and move pricing between tier sets?");
    expect(copy.body).toContain("2026-07-01");
    expect(copy.body).toContain("2026-08-01");

    const sentences = copy.body.split(". ");
    const crossedSentence = sentences.find((s) => s.includes("2026-07-01"));
    const farFutureSentence = sentences.find(
      (s) => s.includes("2026-08-01") && s.includes("permanently"),
    );
    expect(crossedSentence).toBeDefined();
    expect(farFutureSentence).toBeDefined();
    expect(crossedSentence).not.toBe(farFutureSentence);
  });

  it("edit-supersede, far-future limb only: names the far-future date, no 'null' substring anywhere, title is the far-future-only title", () => {
    const copy = buildRestateDialogCopy({
      variant: "edit-supersede",
      days: 0,
      proposedEffectiveFrom: "2026-07-01",
      supersedes: null,
      futureSupersededBy: "2026-08-13",
    });

    expect(copy.title).toBe(
      "Save changes and hand this tier set's later days to another tier set?",
    );
    expect(copy.body).toContain("2026-08-13");
    expect(copy.body).not.toContain("null");
    expect(copy.title).not.toContain("null");
  });

  it("all three edit-supersede titles are pairwise distinct", () => {
    const crossedOnly = buildRestateDialogCopy({
      variant: "edit-supersede",
      days: 0,
      proposedEffectiveFrom: "2026-09-01",
      supersedes: "2026-08-01",
      futureSupersededBy: null,
    }).title;
    const bothLimbs = buildRestateDialogCopy({
      variant: "edit-supersede",
      days: 0,
      proposedEffectiveFrom: "2026-07-15",
      supersedes: "2026-07-01",
      futureSupersededBy: "2026-08-01",
    }).title;
    const farFutureOnly = buildRestateDialogCopy({
      variant: "edit-supersede",
      days: 0,
      proposedEffectiveFrom: "2026-07-01",
      supersedes: null,
      futureSupersededBy: "2026-08-13",
    }).title;

    expect(crossedOnly).not.toBe(bothLimbs);
    expect(crossedOnly).not.toBe(farFutureOnly);
    expect(bothLimbs).not.toBe(farFutureOnly);
  });

  it("edit-supersede, crossed-neighbour limb only: byte-identical to the shipped strings, at zero days", () => {
    const copy = buildRestateDialogCopy({
      variant: "edit-supersede",
      days: 0,
      proposedEffectiveFrom: "2026-09-01",
      supersedes: "2026-08-01",
      futureSupersededBy: null,
    });

    expect(copy.title).toBe("Save changes and take over pricing from another tier set?");
    expect(copy.body).toBe(
      "Moving this tier set to 2026-09-01 makes it price days currently priced by the tier set effective 2026-08-01. No day recorded so far changes. This is recorded in the change history.",
    );
    expect(copy.confirmLabel).toBe("Save changes");
  });

  it("edit-supersede, crossed-neighbour limb only: byte-identical to the shipped strings, at a non-zero day count", () => {
    const copy = buildRestateDialogCopy({
      variant: "edit-supersede",
      days: 5,
      proposedEffectiveFrom: "2026-09-01",
      supersedes: "2026-08-01",
      futureSupersededBy: null,
    });

    expect(copy.title).toBe("Save changes and take over pricing from another tier set?");
    expect(copy.body).toBe(
      "Moving this tier set to 2026-09-01 makes it price days currently priced by the tier set effective 2026-08-01. This restates 5 days already recorded — past figures shown for that period will change. This is recorded in the change history.",
    );
    expect(copy.confirmLabel).toBe("Save and restate revenue");
  });

  it("create-supersede at zero days: byte-identical to the shipped strings", () => {
    const copy = buildRestateDialogCopy({
      variant: "create-supersede",
      days: 0,
      proposedEffectiveFrom: "2026-09-10",
      supersedes: "2026-08-13",
      futureSupersededBy: null,
    });

    expect(copy.title).toBe("Add a new tier set and supersede the current rates?");
    expect(copy.body).toBe(
      "This creates a new tier set effective 2026-09-10. From that date it replaces the tier set effective 2026-08-13 for all revenue. No day recorded so far changes. This is recorded in the change history.",
    );
    expect(copy.confirmLabel).toBe("Add tier set");
  });

  it("create-supersede at a non-zero day count: byte-identical to the shipped strings", () => {
    const copy = buildRestateDialogCopy({
      variant: "create-supersede",
      days: 1,
      proposedEffectiveFrom: "2026-09-10",
      supersedes: "2026-08-13",
      futureSupersededBy: null,
    });

    expect(copy.title).toBe("Add a new tier set and supersede the current rates?");
    expect(copy.body).toBe(
      "This creates a new tier set effective 2026-09-10. From that date it replaces the tier set effective 2026-08-13, including 1 day already recorded, whose revenue will be restated. This is recorded in the change history.",
    );
    expect(copy.confirmLabel).toBe("Add tier set and restate revenue");
  });

  it("plain edit variant: byte-identical to the shipped strings", () => {
    const copy = buildRestateDialogCopy({
      variant: "edit",
      days: 4,
      proposedEffectiveFrom: null,
      supersedes: null,
      futureSupersededBy: null,
    });

    expect(copy.title).toBe("Save changes to pricing tiers?");
    expect(copy.body).toBe(
      "This will restate revenue for 4 days. Past figures shown for that period will change to reflect the corrected rates. This is recorded in the change history.",
    );
    expect(copy.confirmLabel).toBe("Save and restate revenue");
  });

  it("preserves singular 'day' vs plural 'days' on every day-count-reporting variant", () => {
    expect(
      buildRestateDialogCopy({
        variant: "edit",
        days: 1,
        proposedEffectiveFrom: null,
        supersedes: null,
        futureSupersededBy: null,
      }).body,
    ).toContain("1 day.");
    expect(
      buildRestateDialogCopy({
        variant: "edit-supersede",
        days: 1,
        proposedEffectiveFrom: "2026-09-01",
        supersedes: "2026-08-01",
        futureSupersededBy: null,
      }).body,
    ).toContain("1 day already recorded");
    expect(
      buildRestateDialogCopy({
        variant: "create-supersede",
        days: 1,
        proposedEffectiveFrom: "2026-09-10",
        supersedes: "2026-08-13",
        futureSupersededBy: null,
      }).body,
    ).toContain("1 day already recorded");
  });
});
