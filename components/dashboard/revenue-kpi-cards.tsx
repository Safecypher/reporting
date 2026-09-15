import { DrillableMetric } from "@/components/dashboard/drillable-metric";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/**
 * Formats an already-summed revenue total (from the `v_revenue_daily` SQL
 * view's SUM(), never a client-side re-sum — Pitfall 2/T-03-16) as USD,
 * rounded exactly once at this display boundary (L-01). Reused for every
 * money figure this component renders (Bit Addict headline, TSYS
 * secondary) — never a second formatter instance.
 */
function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

/**
 * D-10/D-16: the actual-to-date figure pair this card renders — Bit
 * Addict (the headline, D-09) plus TSYS (the customer-side check, never
 * averaged in). `tsys` is `null` exactly when `tsysError` is true (the
 * per-source RPC call failed) — never a fabricated 0 standing in for a
 * genuine load failure.
 */
export interface RevenueActualPair {
  bitAddict: number;
  tsys: number | null;
  tsysError: boolean;
}

interface RevenueKpiCardsProps {
  /** Bit Addict headline + TSYS secondary figure, both pre-summed by the
   * SQL view — never a client-side re-sum. */
  actual: RevenueActualPair;
}

/**
 * "Revenue to date" card (D-09/D-10/D-16, supersedes the pre-Phase-7
 * "Total revenue" card). The Bit Addict headline keeps the existing 48px
 * Cypher-Blue `.metric` treatment, its Cypher-Blue underline and its
 * `DrillableMetric` drill wrapper unchanged (DASH-03/D-11: revenue is
 * computed from ALL verification counts, D-02, so drilling the headline
 * shows every contributing verification). Beneath it, a TSYS secondary
 * block — deliberately the SMALL (14px) size, not the 20px "paired figure"
 * size used on `/alignment`, because here TSYS is subordinate content
 * inside the Bit Addict card, not an equal (07-UI-SPEC.md Design
 * Aesthetic point 2). The TSYS variance phrase is deliberately NOT built
 * here — plan 07-03 adds it as a shared component so the phrase grammar
 * has exactly one implementation across `/revenue` and `/alignment`.
 */
export function RevenueKpiCards({ actual }: RevenueKpiCardsProps) {
  const { bitAddict, tsys, tsysError } = actual;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Revenue to date
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <DrillableMetric filter={{ drill: "verification" }} aria-label="Drill into revenue to date">
            <span className="inline-block border-b-2 border-[var(--cypher-blue)] pb-1 text-[48px] leading-none font-bold tabular-nums text-[var(--cypher-blue)]">
              {formatCurrency(bitAddict)}
            </span>
          </DrillableMetric>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--fg-3)]">
              TSYS
            </span>
            {tsysError || tsys === null ? (
              <span className="text-sm font-medium text-[var(--fg-2)]">
                TSYS revenue could not be loaded.
              </span>
            ) : (
              <span className="font-mono text-sm font-bold tabular-nums text-[var(--fg-2)]">
                {formatCurrency(tsys)}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
