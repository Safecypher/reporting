"use client";

import { useMemo } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/** Row shape from `v_revenue_by_tier` (D-07 per-tier breakdown). */
export interface RevenueTierRow {
  day_utc: string;
  tier_order: number;
  tier_revenue: string;
  tier_set_id: string;
}

interface TierTotal {
  tierOrder: number;
  revenue: number;
}

/**
 * Aggregates `v_revenue_by_tier` rows (one row per day per tier) into a
 * single period total per tier_order. Sums the NUMERIC-as-string
 * `tier_revenue` values by converting to `number` only at this final
 * aggregation step for display — mirrors revenue-bucketing.ts's rule
 * (Pitfall 2/T-03-16): this is a display aggregation over already-exact
 * per-tier SQL sums, not a re-derivation of the authoritative grand total.
 */
function aggregateByTier(rows: RevenueTierRow[]): TierTotal[] {
  const totals = new Map<number, number>();

  for (const row of rows) {
    const existing = totals.get(row.tier_order) ?? 0;
    totals.set(row.tier_order, existing + Number(row.tier_revenue));
  }

  return Array.from(totals.entries())
    .sort(([a], [b]) => a - b)
    .map(([tierOrder, revenue]) => ({ tierOrder, revenue }));
}

/**
 * Single-hue Cypher-Blue tint ramp for tier order (03-UI-SPEC.md Color:
 * tiers are ordinal, not categorical — never arbitrary hues). Lightest tint
 * for tier 0, darkest (full Cypher Blue) for the highest tier present.
 */
function tintForTier(tierOrder: number, maxTierOrder: number): string {
  if (maxTierOrder === 0) return "var(--cypher-blue)";
  const ratio = tierOrder / maxTierOrder;
  // Interpolate opacity from a light tint (0.25) to full strength (1.0).
  const opacity = 0.25 + ratio * 0.75;
  return `color-mix(in srgb, var(--cypher-blue) ${Math.round(opacity * 100)}%, transparent)`;
}

interface RevenueTierBreakdownProps {
  rows: RevenueTierRow[];
}

export function RevenueTierBreakdown({ rows }: RevenueTierBreakdownProps) {
  const totals = useMemo(() => aggregateByTier(rows), [rows]);
  const maxTierOrder = totals.length > 0 ? totals[totals.length - 1].tierOrder : 0;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-medium text-foreground">Revenue by tier</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tier</TableHead>
            <TableHead className="text-right">Revenue</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {totals.map((tier) => (
            <TableRow key={tier.tierOrder}>
              <TableCell>
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="inline-block size-2.5 rounded-full"
                    style={{ backgroundColor: tintForTier(tier.tierOrder, maxTierOrder) }}
                  />
                  {`Tier ${tier.tierOrder + 1}`}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <span className="font-mono tabular-nums">
                  {currencyFormatter.format(tier.revenue)}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
