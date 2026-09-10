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

function resolveEditImpact(currentEffectiveFrom: string, proposedEffectiveFrom: string): SaveImpact {
  // D-18/P-04, reproduced exactly: the earlier of the set's CURRENT and
  // PROPOSED effectiveFrom, so an edit that moves the boundary in either
  // direction reports every day whose price changes. Never supersedes
  // anything — an edit modifies the selected set in place, it never
  // displaces a different one.
  const from = currentEffectiveFrom < proposedEffectiveFrom ? currentEffectiveFrom : proposedEffectiveFrom;
  return { from, through: null, supersedes: null };
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
    return resolveEditImpact(mode.effectiveFrom, proposedEffectiveFrom);
  }
  return resolveCreateImpact(proposedEffectiveFrom, existingTierSets);
}
