import Link from "next/link";

/**
 * D-19's shared billable-basis caption — the answer to "why does our revenue
 * figure exceed the TSYS invoice". Written ONCE here and rendered in both
 * places it appears: `app/(dashboard)/revenue/page.tsx` (beneath the KPI
 * row) and `app/(dashboard)/alignment/page.tsx`'s fifth Revenue card (as its
 * `footerCaption`). Two hand-maintained copies of this sentence would drift
 * (07-03 D-19) — every consumer imports one of the two exports below rather
 * than re-typing the wording.
 */
export const REVENUE_BILLABLE_BASIS_CAPTION =
  "Revenue counts every verification, whether or not it was authenticated, so it may exceed an authorised-only TSYS invoice — see the Reconciliation page for the difference.";

/**
 * Renders `REVENUE_BILLABLE_BASIS_CAPTION` with "Reconciliation" wrapped in a
 * `next/link` `Link` to `/reconciliation`. Built by splitting the exported
 * constant (rather than re-typing the sentence with the link inline), so the
 * linked render and the plain string provably cannot diverge — "Reconciliation"
 * appears exactly once in the constant, so the split yields exactly the text
 * before and after it.
 */
export function RevenueBasisCaption() {
  const [before, after] = REVENUE_BILLABLE_BASIS_CAPTION.split("Reconciliation");

  return (
    <p className="text-xs font-light text-[var(--fg-3)]">
      {before}
      <Link href="/reconciliation" className="text-primary underline underline-offset-4">
        Reconciliation
      </Link>
      {after}
    </p>
  );
}
