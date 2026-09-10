import Link from "next/link";

import type { ResolvedPeriod } from "@/lib/dashboard/period";

/**
 * Neutral "the selected period has no rows" state (UI-SPEC E4) — distinct
 * from a view's domain empty state (no data at all, ever). Copies the
 * `EmptyState` container/icon/heading/body shape (see
 * app/(dashboard)/revenue/page.tsx's `EmptyState`) but with the `#calendar`
 * glyph and a `View current month` recovery link — it must NEVER carry the
 * domain empty state's report-upload call to action, since uploading cannot
 * fix a correct absence of past-period data (UI-SPEC binding distinction).
 */
export function PeriodEmptyState({
  viewNoun,
  period,
}: {
  viewNoun: string;
  period: ResolvedPeriod;
}) {
  const currentMonth = new Date().toISOString().slice(0, 7);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-12 text-center">
      <svg aria-hidden="true" className="size-8 text-muted-foreground">
        <use href="/icons.svg#calendar" />
      </svg>
      <h2 className="text-lg font-medium text-foreground">No data in this period</h2>
      <p className="max-w-md text-sm font-light text-muted-foreground">
        {`No ${viewNoun} recorded for ${period.label}.`}{" "}
        <Link
          href={`?period=month&of=${currentMonth}`}
          className="text-primary underline underline-offset-4"
        >
          View current month
        </Link>
      </p>
    </div>
  );
}
