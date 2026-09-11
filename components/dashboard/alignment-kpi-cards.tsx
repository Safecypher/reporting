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

export function PairedMetricCard({
  metricLabel,
  data,
}: {
  metricLabel: string;
  data: PairedMetricCardData;
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
        <StatusBadge
          status={alignmentStatusToReconciliationStatus(status)}
          label={alignmentStatusToLabel(status)}
        />
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
        </div>
        <div className="flex min-w-[8ch] flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--fg-3)]">
            Bit Addict
          </span>
          <span className="font-mono text-[20px] font-bold tabular-nums text-[var(--fg-1)]">
            {formatCount(bitAddictCount)}
          </span>
        </div>
      </div>
      <p className="text-sm font-medium text-[var(--fg-2)]">
        <DeltaPhrase tsysCount={tsysCount} bitAddictCount={bitAddictCount} />
      </p>
      <p className="text-xs font-light text-[var(--fg-3)]">{coverageStatement}</p>
    </CardShell>
  );
}
