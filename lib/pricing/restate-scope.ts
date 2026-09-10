/**
 * G-05-5 gap closure (05-07): the pure resolver deciding whether a pricing-
 * tier save changes the price of days an existing tier set already prices,
 * and over which day range.
 *
 * Root cause of the incident this closes: `components/pricing/pricing-tier-form.tsx`
 * exempted every brand-new tier set from the restate-warning dialog (P-04,
 * 05-04-PLAN.md) — correct for the genuinely-first tier set, wrong for a new
 * set landing on top of an already-active one. A new 2-tier set effective
 * 2026-09-10 silently superseded the signed 6-tier TSYS MSA ladder
 * (effective 2026-08-13) for all revenue from that date onward, with no
 * confirmation.
 *
 * The gate implemented here is deliberately STRUCTURAL — "does an existing
 * tier set already price the proposed effective date" — and NOT based on a
 * count of already-elapsed activity days. Read literally, the gap text
 * ("would supersede an active set from a date already carrying revenue
 * activity") would NOT have caught the live incident: the stray set was
 * effective 2026-09-10 while ingested data ran only to 2026-09-08, so an
 * activity-day count would have been zero and the save would have proceeded
 * silently again. The structural trigger is strictly stronger and never
 * weaker; the activity-day count is still computed by the caller and
 * carried into the dialog copy as detail, not used as the gate (D-17, D-18).
 *
 * G-05-CR01 gap closure (05-09, closing code-review BLOCKER CR-01): the same
 * defect class, reachable via the EDIT path instead of create. The 05-07 fix
 * above only covered a brand-new tier set landing on an already-priced date;
 * `resolveEditImpact` still hardcoded `supersedes: null` and its doc comment
 * asserted an edit "never displaces a different one." That is true at the
 * ROW level and false at the PRICING level — see that function's doc comment
 * below for the full explanation, and 05-REVIEW.md's CR-01 for the
 * three-tier-set worked example that exposed it.
 */

export type TierSetSaveMode =
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly id: string; readonly effectiveFrom: string };

export interface ExistingTierSet {
  readonly id: string;
  readonly effectiveFrom: string;
}

export interface SaveImpact {
  /** Inclusive first affected day (`YYYY-MM-DD`, UTC). */
  readonly from: string;
  /** Inclusive last affected day, or null meaning open-ended. */
  readonly through: string | null;
  /** The effective date of the tier set being displaced, or null. */
  readonly supersedes: string | null;
}

/**
 * `YYYY-MM-DD` UTC day arithmetic via `Date.UTC` parse + zero-padded
 * reconstruction — mirroring the phase convention (`lib/dashboard/period.ts`)
 * that UTC date helpers stay module-local rather than reaching for
 * date-fns's local-getter functions, which would silently misdate a UTC
 * period boundary in a non-UTC process timezone. `period.ts`'s helpers are
 * not exported, so this is a deliberate, minimal, local reimplementation —
 * not a shared import.
 */
function decrementUtcDay(dateIso: string): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * G-05-CR01: an edit CAN transfer pricing authority away from a DIFFERENT
 * tier set. `v_revenue_tier_set_by_day` (`supabase/migrations/0012_v_revenue.sql`)
 * resolves each day's governing tier set purely by relative `effective_from`
 * ordering — `where effective_from <= day order by effective_from desc limit
 * 1` — with no notion of "this row already covered that day before the
 * edit." The previous version of this function encoded exactly that
 * row-level intuition ("an edit modifies the selected set in place, it never
 * displaces a different one") — true of the ROW, false of the PRICING, and
 * precisely what let this blocker through. `from` deliberately stays the
 * earlier of the current and proposed dates in every case regardless of
 * displacement: the edited set's own rate change always restates its own
 * days, whether or not the move also takes days from another set.
 *
 * Displacement predicate (hand-traceable): drop the edited set's own row,
 * keep every other set at-or-before the PROPOSED date, and take the latest
 * of those as the candidate. The candidate is NOT a displacement only when
 * the edited set already governed the proposed day before this move — i.e.
 * `proposed >= current` (moving later or unchanged) AND
 * `candidate <= current` (the candidate already sat at or before the set's
 * OWN prior date, so it was never the one pricing the newly-claimed days).
 * Moving later, the candidate must therefore lie strictly between `current`
 * and `proposed` to count as displaced. Backdating (`proposed < current`),
 * the first half of that condition is false, so the candidate is ALWAYS a
 * genuine displacement — this is why the code review's own one-line filter
 * (`effectiveFrom <= proposed && effectiveFrom > current`) is insufficient
 * as written: it is empty for every backdate, which is the direction the
 * live incident's sibling defect actually took.
 */
function resolveEditImpact(
  editedId: string,
  currentEffectiveFrom: string,
  proposedEffectiveFrom: string,
  existingTierSets: readonly ExistingTierSet[],
): SaveImpact {
  // D-18/P-04, reproduced exactly: the earlier of the set's CURRENT and
  // PROPOSED effectiveFrom, so an edit that moves the boundary in either
  // direction reports every day whose price changes.
  const from = currentEffectiveFrom < proposedEffectiveFrom ? currentEffectiveFrom : proposedEffectiveFrom;

  // Exclude the edited set's own row — it may or may not be present in the
  // caller's list — before scanning for a displaced set. An edit must never
  // report itself as superseding itself.
  const others = existingTierSets.filter((set) => set.id !== editedId);

  const atOrBeforeProposed = others.filter(
    (set) => set.effectiveFrom <= proposedEffectiveFrom,
  );

  const candidate =
    atOrBeforeProposed.length === 0
      ? null
      : atOrBeforeProposed.reduce(
          (latest, set) => (set.effectiveFrom > latest.effectiveFrom ? set : latest),
          atOrBeforeProposed[0],
        );

  const alreadyGoverned =
    candidate !== null &&
    proposedEffectiveFrom >= currentEffectiveFrom &&
    candidate.effectiveFrom <= currentEffectiveFrom;

  const displaced = alreadyGoverned ? null : candidate;

  if (displaced === null) {
    return { from, through: null, supersedes: null };
  }

  // Only reachable when a displacement was found. Mirrors the create
  // branch's `through` computation: the day before the earliest OTHER set
  // whose date is strictly later than the later of the current/proposed
  // dates, or null when there is no such set.
  const laterDate = currentEffectiveFrom > proposedEffectiveFrom ? currentEffectiveFrom : proposedEffectiveFrom;

  const strictlyLater = others.filter((set) => set.effectiveFrom > laterDate);

  const through =
    strictlyLater.length === 0
      ? null
      : decrementUtcDay(
          strictlyLater.reduce(
            (earliest, set) => (set.effectiveFrom < earliest ? set.effectiveFrom : earliest),
            strictlyLater[0].effectiveFrom,
          ),
        );

  return { from, through, supersedes: displaced.effectiveFrom };
}

function resolveCreateImpact(
  proposedEffectiveFrom: string,
  existingTierSets: readonly ExistingTierSet[],
): SaveImpact | null {
  // ISO `YYYY-MM-DD` strings compare correctly with plain string
  // comparison — reserve Date arithmetic for the day decrement alone.
  const atOrBefore = existingTierSets.filter(
    (set) => set.effectiveFrom <= proposedEffectiveFrom,
  );

  if (atOrBefore.length === 0) {
    // Nothing active prices this date yet — the genuinely-first-set case
    // (or a proposed date that precedes every existing set) stays
    // frictionless, exactly as P-04 intended.
    return null;
  }

  const supersedes = atOrBefore.reduce(
    (latest, set) => (set.effectiveFrom > latest ? set.effectiveFrom : latest),
    atOrBefore[0].effectiveFrom,
  );

  const strictlyLater = existingTierSets.filter(
    (set) => set.effectiveFrom > proposedEffectiveFrom,
  );

  const through =
    strictlyLater.length === 0
      ? null
      : decrementUtcDay(
          strictlyLater.reduce(
            (earliest, set) => (set.effectiveFrom < earliest ? set.effectiveFrom : earliest),
            strictlyLater[0].effectiveFrom,
          ),
        );

  return { from: proposedEffectiveFrom, through, supersedes };
}

/**
 * Resolves whether saving `proposedEffectiveFrom` under `mode` changes the
 * price of any day an existing tier set already prices, and over which
 * range. Returns null when nothing is affected (save immediately, no
 * confirmation needed).
 */
export function resolveSaveImpact(
  mode: TierSetSaveMode,
  proposedEffectiveFrom: string,
  existingTierSets: readonly ExistingTierSet[],
): SaveImpact | null {
  if (mode.kind === "edit") {
    return resolveEditImpact(mode.id, mode.effectiveFrom, proposedEffectiveFrom, existingTierSets);
  }
  return resolveCreateImpact(proposedEffectiveFrom, existingTierSets);
}
