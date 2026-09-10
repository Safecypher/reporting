import { Badge } from "@/components/ui/badge";
import type { ResolvedPeriod } from "@/lib/dashboard/period";

/**
 * Active-scope indicator (T-05-06/success criterion 2). Server-renderable —
 * rendered by the same Server Component that resolved the period and built
 * the query, from the `ResolvedPeriod` object itself, so it can never state
 * a period other than the one actually applied (UI-SPEC scope-indicator
 * binding rule). Copies `FreshnessBadge`'s exact `Badge variant="outline"` +
 * sprite-icon shape (see app/(dashboard)/revenue/page.tsx) so the two badges
 * read as one meta line.
 *
 * Never `--primary` and never a semantic status colour — scope is a fact,
 * not a judgement (UI-SPEC Color binding).
 */
export function ScopeBadge({ period }: { period: ResolvedPeriod }) {
  return (
    <Badge variant="outline" className="gap-1.5 font-normal text-muted-foreground">
      <svg aria-hidden="true" className="size-3">
        <use href="/icons.svg#calendar" />
      </svg>
      {`Showing ${period.label}`}
    </Badge>
  );
}
