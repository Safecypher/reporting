import type { ReactNode } from "react";

import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/dashboard/status-badge";
import {
  alignmentStatusToLabel,
  alignmentStatusToReconciliationStatus,
  computeAlignmentShortSide,
  formatCoverageStatement,
  pctVariance,
  type AlignmentStatus,
} from "@/lib/dashboard/alignment-status";

/**
 * The paired-figure KPI card (D-18, UI-SPEC "Paired KPI card internal
 * hierarchy"). No function-bearing props/column defs, so this stays a
 * Server Component like every other KPI card in the app — the shared
 * `StatusBadge` it renders is a `'use client'` leaf, which a Server
 * Component may still import and render directly.
 *
 * Internal hierarchy, top to bottom (binding, UI-SPEC): status badge in the
 * card header's top-right, the only coloured element on the card face; the
 * two figures side by side, neutral `--fg-1` ink, never colourised by
 * source; the delta/which-side-short phrase; the coverage statement.
 *
 * The live-cards card (Plan 06-03) additionally renders two permanent
 * captions, formatted by `lib/dashboard/alignment-status.ts` and passed in
 * by the page: a derivation caption stating the cumulative enrol − unenrol
 * formula, the baseline offset and its as-of date (D-08), rendered directly
 * under the TSYS figure via `tsysCaption`; and a status-meaning caption
 * stating that the badge reflects the change in the gap between TSYS and
 * Bit Addict, not the gap's size (D-07), rendered near the badge via
 * `statusMeaningCaption`. Neither is a tooltip — both are always rendered.
 */

function formatCount(value: number): string {
  return value.toLocaleString();
}

function CardShell({
  metricLabel,
  action,
  children,
}: {
  metricLabel: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {metricLabel}
        </CardTitle>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">{children}</CardContent>
    </Card>
  );
}

/** Loading state — its own shape, independent of the other cards (UI-SPEC E2). */
export function PairedMetricCardSkeleton({ metricLabel }: { metricLabel: string }) {
  return (
    <CardShell metricLabel={metricLabel}>
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-2/3" />
    </CardShell>
  );
}

/** Scoped error state — a single metric's failure leaves the other cards
 * readable (UI-SPEC E2). */
export function PairedMetricCardError({ metricLabel }: { metricLabel: string }) {
  return (
    <CardShell metricLabel={metricLabel}>
      <div className="flex flex-col items-center gap-2 py-4 text-center">
        <svg aria-hidden="true" className="size-6 text-destructive">
          <use href="/icons.svg#alert" />
        </svg>
        <p className="text-sm font-light text-muted-foreground">
          {metricLabel} could not be loaded.
        </p>
      </div>
    </CardShell>
  );
}

/** Period-empty treatment — never a zero figure standing in for an absence
 * (UI-SPEC E2). */
export function PairedMetricCardPeriodEmpty({ metricLabel }: { metricLabel: string }) {
  return (
    <CardShell metricLabel={metricLabel}>
      <p className="text-sm font-light text-muted-foreground">
        {`No ${metricLabel.toLowerCase()} data for this period.`}
      </p>
    </CardShell>
  );
}

/**
 * Renders the delta/which-side-short phrase (Copywriting Contract). The
 * D-14 zero case is built here, not via `formatDeltaPhrase`'s plain string,
 * so the em dash carries its own `aria-label` — the reason for the missing
 * percentage reaches the accessibility tree unconditionally, never only on
 * hover.
 */
function DeltaPhrase({
  tsysCount,
  bitAddictCount,
}: {
  tsysCount: number;
  bitAddictCount: number;
}) {
  if (tsysCount === bitAddictCount) {
    return <>TSYS and Bit Addict match exactly.</>;
  }

  const shortSide = computeAlignmentShortSide(tsysCount, bitAddictCount);
  const sideLabel = shortSide === "tsys" ? "TSYS" : "Bit Addict";
  const absDelta = Math.abs(tsysCount - bitAddictCount).toLocaleString();
  const pct = pctVariance(tsysCount, bitAddictCount);

  if (pct === null) {
    return (
      <>
        {`${sideLabel} is short by ${absDelta} (`}
        <span aria-label="Percentage not applicable — Bit Addict recorded zero for this metric">
          —
        </span>
        {`).`}
      </>
    );
  }

  return <>{`${sideLabel} is short by ${absDelta} (${pct}%).`}</>;
}

export interface PairedMetricCardData {
  tsysCount: number;
  bitAddictCount: number;
  status: AlignmentStatus;
  tsysCoveredDays: number;
  bitAddictCoveredDays: number;
  totalDays: number;
}

/**
 * Live cards (Plan 06-03, D-06/D-07/D-08) is the one metric whose card face
 * carries two EXTRA permanent captions, both always rendered, neither a
 * tooltip — the derivation caption states the cumulative enrol − unenrol
 * formula, the baseline offset and its as-of date (D-08), directly under
 * the TSYS figure; the status-meaning caption states that the badge
 * reflects the change in the gap between TSYS and Bit Addict, not the
 * gap's size (D-07), positioned near the badge instead — the two sit in
 * different positions on purpose, because they answer two different
 * questions ("what is this number" vs "what does this badge mean") and
 * must not merge into one paragraph. `bitAddictAsOfCaption` mirrors
 * `/cards`' as-at phrasing (P-02/L-02) for the Bit Addict stock figure,
 * naming the snapshot day it was carried forward from.
 */
export function PairedMetricCard({
  metricLabel,
  data,
  tsysCaption,
  statusMeaningCaption,
  bitAddictAsOfCaption,
}: {
  metricLabel: string;
  data: PairedMetricCardData;
  tsysCaption?: string;
  statusMeaningCaption?: string;
  bitAddictAsOfCaption?: string;
}) {
  const {
    tsysCount,
    bitAddictCount,
    status,
    tsysCoveredDays,
    bitAddictCoveredDays,
    totalDays,
  } = data;

  const coverageStatement = formatCoverageStatement(
    tsysCoveredDays,
    bitAddictCoveredDays,
    totalDays,
  );

  return (
    <CardShell
      metricLabel={metricLabel}
      action={
        <div className="flex flex-col items-end gap-1">
          <StatusBadge
            status={alignmentStatusToReconciliationStatus(status)}
            label={alignmentStatusToLabel(status)}
          />
          {statusMeaningCaption ? (
            <p className="max-w-[22ch] text-right text-xs font-light text-[var(--fg-3)]">
              {statusMeaningCaption}
            </p>
          ) : null}
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <div className="flex min-w-[8ch] flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--fg-3)]">
            TSYS
          </span>
          <span className="font-mono text-[20px] font-bold tabular-nums text-[var(--fg-1)]">
            {formatCount(tsysCount)}
          </span>
          {tsysCaption ? (
            <span className="text-xs font-light text-[var(--fg-3)]">{tsysCaption}</span>
          ) : null}
        </div>
        <div className="flex min-w-[8ch] flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--fg-3)]">
            Bit Addict
          </span>
          <span className="font-mono text-[20px] font-bold tabular-nums text-[var(--fg-1)]">
            {formatCount(bitAddictCount)}
          </span>
          {bitAddictAsOfCaption ? (
            <span className="text-xs font-light text-[var(--fg-3)]">{bitAddictAsOfCaption}</span>
          ) : null}
        </div>
      </div>
      <p className="text-sm font-medium text-[var(--fg-2)]">
        <DeltaPhrase tsysCount={tsysCount} bitAddictCount={bitAddictCount} />
      </p>
      <p className="text-xs font-light text-[var(--fg-3)]">{coverageStatement}</p>
    </CardShell>
  );
}
