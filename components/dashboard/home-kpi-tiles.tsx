import type { ReactNode } from "react";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The three home-page headline KPI tiles (D-05, UI-SPEC "Home page headline
 * KPI tiles"): `Live cards`, `Volume this period`, `Revenue this period`.
 * Each is a deliberate READ-ONLY DUPLICATE of a figure already shown on its
 * own canonical page (`/cards`, `/verifications`, `/revenue`) — the page
 * (`app/(dashboard)/page.tsx`) reads the SAME sources those pages read and
 * passes the already-computed figure in as a prop; nothing here re-derives a
 * number (a home figure that disagreed with its own canonical page would be
 * worse than no home figure at all).
 *
 * `Live cards` is unscoped by period (a STOCK metric, L-02) — its label
 * carries no period wording, unlike the other two, which explicitly say
 * "this period" — the label text itself is what keeps a tile's scoping
 * unambiguous (no separate caption needed).
 *
 * The tile row is fixed at exactly three tiles in every state (UI-SPEC
 * E6) — a tile with no value for its scope still occupies its slot via
 * `HomeKpiTileNoData`, never collapsing the row to two, and never showing a
 * fabricated zero in place of a genuine absence.
 *
 * No accent-teal underline on any of the three (Color, UI-SPEC binding) —
 * all three are equally weighted; the underline is reserved brand-wide for
 * one deliberate highlight.
 */

function HomeKpiTileShell({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">{children}</CardContent>
    </Card>
  );
}

function TileLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex w-fit items-center gap-1 text-sm text-primary underline underline-offset-4"
    >
      {label}
      <svg aria-hidden="true" className="size-3">
        <use href="/icons.svg#arrow-right" />
      </svg>
    </Link>
  );
}

/** Loading state — its own shape, independent of the other two tiles and of
 * the alignment strip (UI-SPEC E6). `hasSubLine` (07-UI-SPEC E4) renders an
 * extra skeleton line beneath the headline skeleton, matching the shape the
 * populated tile takes when it carries a projection sub-line — used only by
 * the revenue tile's loading placeholder, independent of the other two. */
export function HomeKpiTileSkeleton({
  label,
  hasSubLine,
}: {
  label: string;
  hasSubLine?: boolean;
}) {
  return (
    <HomeKpiTileShell label={label}>
      <Skeleton className="h-12 w-32" />
      {hasSubLine && <Skeleton className="h-4 w-40" />}
      <Skeleton className="h-4 w-28" />
    </HomeKpiTileShell>
  );
}

/** A tile whose own read failed — scoped to this tile only; the other two
 * tiles and the alignment strip still render (UI-SPEC E6, T-06-34). */
function HomeKpiTileError({ label }: { label: string }) {
  return (
    <HomeKpiTileShell label={label}>
      <p className="text-sm font-light text-muted-foreground">{label} could not be loaded.</p>
    </HomeKpiTileShell>
  );
}

/** No data for this tile's scope — an EXPLICIT no-data treatment, never a
 * fabricated zero figure (UI-SPEC E6). Still links out to the canonical
 * page, since data may exist there for a different scope. */
function HomeKpiTileNoData({
  label,
  linkHref,
  linkLabel,
}: {
  label: string;
  linkHref: string;
  linkLabel: string;
}) {
  return (
    <HomeKpiTileShell label={label}>
      <p className="text-sm font-light text-muted-foreground">No data yet.</p>
      <TileLink href={linkHref} label={linkLabel} />
    </HomeKpiTileShell>
  );
}

/**
 * The populated tile: the brand 48px `.metric` value (Cypher Blue, no
 * accent-teal underline — none of the three tiles is more important than the
 * others) with its 12px uppercase label and a `View {page}` link affordance.
 * `value` is pre-formatted by the caller (comma-grouped count, or currency)
 * so this component never re-derives formatting per figure type — the tile
 * grows to fit a long value rather than shrinking or eliding it (no
 * clamping utility is ever applied here).
 *
 * `subLine` (D-18, 07-UI-SPEC E4) is an optional 14px `--provisional`-ink
 * line rendered directly beneath the headline value and above the
 * `TileLink` — currently only `RevenueThisPeriodTile` populates it, with the
 * projection sub-line. When absent, the tile renders exactly as it did
 * before this prop existed: no empty element, no blank line. A long
 * `subLine` value is free to wrap onto a second line — no class here clamps
 * line count or elides overflow.
 */
function HomeKpiTilePopulated({
  label,
  value,
  subLine,
  linkHref,
  linkLabel,
}: {
  label: string;
  value: string;
  subLine?: string;
  linkHref: string;
  linkLabel: string;
}) {
  return (
    <HomeKpiTileShell label={label}>
      <span className="text-[48px] leading-none font-bold tabular-nums text-[var(--cypher-blue)]">
        {value}
      </span>
      {subLine !== undefined && (
        <span className="text-sm font-medium text-[var(--provisional)]">{subLine}</span>
      )}
      <TileLink href={linkHref} label={linkLabel} />
    </HomeKpiTileShell>
  );
}

export function LiveCardsTile({
  count,
  hasData,
  error,
}: {
  count: number;
  hasData: boolean;
  error: boolean;
}) {
  const label = "Live cards";
  if (error) return <HomeKpiTileError label={label} />;
  if (!hasData) {
    return <HomeKpiTileNoData label={label} linkHref="/cards" linkLabel="View cards" />;
  }
  return (
    <HomeKpiTilePopulated
      label={label}
      value={count.toLocaleString()}
      linkHref="/cards"
      linkLabel="View cards"
    />
  );
}

export function VolumeThisPeriodTile({
  count,
  hasData,
  error,
}: {
  count: number;
  hasData: boolean;
  error: boolean;
}) {
  const label = "Volume this period";
  if (error) return <HomeKpiTileError label={label} />;
  if (!hasData) {
    return <HomeKpiTileNoData label={label} linkHref="/verifications" linkLabel="View verifications" />;
  }
  return (
    <HomeKpiTilePopulated
      label={label}
      value={count.toLocaleString()}
      linkHref="/verifications"
      linkLabel="View verifications"
    />
  );
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function RevenueThisPeriodTile({
  total,
  hasData,
  error,
  projectedSubLine,
}: {
  total: number;
  hasData: boolean;
  error: boolean;
  /** D-18, 07-UI-SPEC E4: the projection sub-line, absent (not empty) when
   * the projection is not computable — a past scope, a below-threshold
   * degraded forecast, or a failed fetch all collapse to "no sub-line",
   * never a second error message or a fabricated zero on this tile. */
  projectedSubLine?: string;
}) {
  const label = "Revenue this period";
  if (error) return <HomeKpiTileError label={label} />;
  if (!hasData) {
    return <HomeKpiTileNoData label={label} linkHref="/revenue" linkLabel="View revenue" />;
  }
  return (
    <HomeKpiTilePopulated
      label={label}
      value={currencyFormatter.format(total)}
      subLine={projectedSubLine}
      linkHref="/revenue"
      linkLabel="View revenue"
    />
  );
}
