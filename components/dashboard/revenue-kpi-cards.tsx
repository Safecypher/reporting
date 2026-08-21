import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/**
 * Formats an already-summed revenue total (from the `v_revenue_daily` SQL
 * view's SUM(), never a client-side re-sum — Pitfall 2/T-03-16) as USD,
 * rounded exactly once at this display boundary (L-01).
 */
function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

interface RevenueKpiCardsProps {
  /** The pre-summed grand total, in dollars, computed by the SQL view. */
  total: number;
}

/**
 * Total revenue `.metric` card — brand treatment identical to
 * kpi-cards.tsx's MetricCard (Poppins 700, 48px, Cypher Blue underline),
 * but formatted as currency instead of a plain count (03-UI-SPEC.md
 * Typography: money and counts share the same `.metric` shape, only the
 * formatter differs).
 */
export function RevenueKpiCards({ total }: RevenueKpiCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Total revenue
          </CardTitle>
        </CardHeader>
        <CardContent>
          <span className="inline-block border-b-2 border-[var(--cypher-blue)] pb-1 text-[48px] leading-none font-bold tabular-nums text-[var(--cypher-blue)]">
            {formatCurrency(total)}
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
