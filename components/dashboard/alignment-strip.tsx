import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/dashboard/status-badge";
import {
  formatRollupSentence,
  rollupAlignmentStatus,
  type AlignmentMetricStatus,
} from "@/lib/dashboard/alignment-rollup";
import { alignmentStatusToLabel, alignmentStatusToReconciliationStatus } from "@/lib/dashboard/alignment-status";
import type { ReconciliationStatus } from "@/lib/dashboard/reconciliation-status";

/**
 * Home-page alignment status strip (ALIGN-05, ROADMAP SC5). The first thing
 * below the page header — leadership's first question is "are we OK today?"
 * Rolls the four per-metric verdicts up into ONE worst-status-wins badge,
 * beside the one-line rollup sentence naming the affected metrics, and beside
 * the row of four per-metric mini-badges — the badge is never shown alone
 * (06-UI-SPEC.md Interaction contract), because a viewer must be able to see
 * both "are we OK overall" and "which metric, specifically" without
 * navigating away. That combination is what makes ROADMAP SC5 true on the
 * home page itself, not only on `/alignment`.
 *
 * BINDING (T-06-33): before any comparison can be computed for the period
 * (every metric's status is `null`), `formatRollupSentence` renders this
 * neutral not-yet-available copy verbatim, never a default green "Aligned"
 * badge just because there is nothing to disagree about yet:
 *
 *   "Alignment status will appear once TSYS and Bit Addict data exist for this period."
 *
 * `rollupAlignmentStatus` enforces the underlying `null` guard in its own
 * return value; this component never overrides either.
 *
 * A metric whose status is `null` (its own fetch failed, or genuinely no
 * comparison exists) still occupies its slot in the mini-badge row, shown
 * with the same neutral "not available" treatment as the shared
 * `no_source_data` badge — never omitted from the row of four.
 */
export function AlignmentStrip({
  metrics,
  periodLabel,
}: {
  metrics: AlignmentMetricStatus[];
  periodLabel: string;
}) {
  const rollup = rollupAlignmentStatus(metrics);
  const sentence = formatRollupSentence(rollup, periodLabel);

  const rollupBadgeStatus: ReconciliationStatus =
    rollup.status === null ? "no_source_data" : alignmentStatusToReconciliationStatus(rollup.status);
  const rollupBadgeLabel = rollup.status === null ? undefined : alignmentStatusToLabel(rollup.status);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={rollupBadgeStatus} label={rollupBadgeLabel} />
          <p className="text-sm font-medium text-foreground">{sentence}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {metrics.map((metric) => (
            <div key={metric.metric} className="flex items-center gap-1.5">
              <span className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {metric.metric}
              </span>
              <StatusBadge
                status={
                  metric.status === null
                    ? "no_source_data"
                    : alignmentStatusToReconciliationStatus(metric.status)
                }
                label={metric.status === null ? "Not available" : alignmentStatusToLabel(metric.status)}
              />
            </div>
          ))}
        </div>
        <Link
          href="/alignment"
          className="inline-flex w-fit items-center gap-1 text-sm text-primary underline underline-offset-4"
        >
          View alignment
          <svg aria-hidden="true" className="size-3">
            <use href="/icons.svg#arrow-right" />
          </svg>
        </Link>
      </CardContent>
    </Card>
  );
}

/** Loading state — its own shape, independent of the three KPI tiles below it (UI-SPEC E5). */
export function AlignmentStripSkeleton() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-5 w-64" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-32" />
        </div>
        <Skeleton className="h-4 w-28" />
      </CardContent>
    </Card>
  );
}
