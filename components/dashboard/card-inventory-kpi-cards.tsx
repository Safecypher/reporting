import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface CardInventoryKpiCardsProps {
  enrolledCount: number;
  /** e.g. "+11 since 13 Aug 2026 (11 days earlier)" — null when there is no
   * previous snapshot to diff against (a single snapshot, or none). */
  changeCaption: string | null;
  latestSnapshotDay: string | null;
  totalRemovals: number;
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

function formatDay(day: string | null): string {
  if (!day) return "—";
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { dateStyle: "medium" });
}

/**
 * Brand `.metric` treatment (01-UI-SPEC.md Typography), mirroring
 * `kpi-cards.tsx` — but not drillable: there is no "cards" drill entity in
 * `drill-params.ts` (out of scope for this quick task).
 */
function MetricCard({
  label,
  value,
  caption,
  accent = false,
}: {
  label: string;
  value: string;
  caption?: string | null;
  accent?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <span
          className={cn(
            "inline-block border-b-2 pb-1 text-[48px] leading-none font-bold tabular-nums text-[var(--cypher-blue)]",
            accent ? "border-[var(--cypher-accent)]" : "border-[var(--cypher-blue)]",
          )}
        >
          {value}
        </span>
        {caption ? (
          <span className="text-sm font-light text-muted-foreground">{caption}</span>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function CardInventoryKpiCards({
  enrolledCount,
  changeCaption,
  latestSnapshotDay,
  totalRemovals,
}: CardInventoryKpiCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <MetricCard
        label="Cards enrolled (latest snapshot)"
        value={formatCount(enrolledCount)}
        caption={changeCaption}
        accent
      />
      <MetricCard label="Latest snapshot date" value={formatDay(latestSnapshotDay)} />
      <MetricCard label="Total removals in window" value={formatCount(totalRemovals)} />
    </div>
  );
}
