import { DrillableMetric } from "@/components/dashboard/drillable-metric";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DrillFilter } from "@/lib/dashboard/drill-params";
import { cn } from "@/lib/utils";

interface KpiCardsProps {
  total: number;
  authenticated: number;
  failed: number;
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

/**
 * Brand `.metric` treatment (01-UI-SPEC.md Typography): Poppins Bold, Cypher
 * Blue, 2px underline. One accent-teal underline max per screen — reserved
 * for the single headline stat (Total verifications).
 *
 * DASH-03/D-11: every KPI is a drillable summary metric — wrapped in
 * `DrillableMetric`, which sets the whitelisted `?drill=verification&...`
 * URL params via `router.replace` (D-10) on click.
 */
function MetricCard({
  label,
  value,
  filter,
  accent = false,
}: {
  label: string;
  value: number;
  filter: DrillFilter;
  accent?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <DrillableMetric filter={filter} aria-label={`Drill into ${label.toLowerCase()}`}>
          <span
            className={cn(
              "inline-block border-b-2 pb-1 text-[48px] leading-none font-bold tabular-nums text-[var(--cypher-blue)]",
              accent
                ? "border-[var(--cypher-accent)]"
                : "border-[var(--cypher-blue)]",
            )}
          >
            {formatCount(value)}
          </span>
        </DrillableMetric>
      </CardContent>
    </Card>
  );
}

export function KpiCards({ total, authenticated, failed }: KpiCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <MetricCard
        label="Total verifications"
        value={total}
        filter={{ drill: "verification" }}
        accent
      />
      <MetricCard
        label="Authenticated"
        value={authenticated}
        filter={{ drill: "verification", authenticated: true }}
      />
      <MetricCard
        label="Failed"
        value={failed}
        filter={{ drill: "verification", authenticated: false }}
      />
    </div>
  );
}
