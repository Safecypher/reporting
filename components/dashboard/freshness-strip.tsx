import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { createClient } from "@/lib/supabase/server";
import { fetchFreshnessStripData, type FreshnessResolution } from "@/lib/dashboard/freshness";

/**
 * Six-source freshness strip (FRESH-01/FRESH-02/FRESH-03, D-16/D-17,
 * ROADMAP SC-1/SC-2/SC-3) — the "loud absence" first-read region on both
 * the dashboard home and `/uploads`, replacing the former whole-system
 * `FreshnessBadge`. Structured after `AlignmentStrip`
 * (components/dashboard/alignment-strip.tsx): a `Card`/`CardContent`
 * sentence slot (here, the D-09 inbox-stuck line) above a fixed-order grid
 * of per-source badges.
 *
 * No outbound "View more" link (unlike `AlignmentStrip`'s `/alignment`
 * link) — there is no third, deeper freshness page this phase; the two
 * rendering locations (dashboard home, `/uploads`) are themselves the whole
 * picture (UI-SPEC E1).
 */
export function FreshnessStrip({
  items,
  stuckCount,
  stuckSince,
}: {
  items: FreshnessResolution[];
  stuckCount: number;
  stuckSince: string | null;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        {stuckCount > 0 && (
          <p className="text-sm font-medium text-[color:var(--warning)]">
            {stuckCount} objects stuck in the inbox since {formatStuckSince(stuckSince)}
          </p>
        )}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
          {items.map((item) => (
            <div key={item.reportType} className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {item.label}
                </span>
                <StatusBadge status={item.badgeStatus} label={item.badgeLabel} />
              </div>
              {item.caption && (
                <p className="text-xs font-light text-muted-foreground">{item.caption}</p>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** D-09's inbox-stuck sentence timestamp: en-GB medium-date/short-time,
 * matching `CredentialsTable`'s "Last used" convention. `stuckSince` is only
 * ever read when `stuckCount > 0`, so a null here would indicate a data
 * inconsistency rather than a normal case — render a neutral placeholder
 * rather than throwing. */
function formatStuckSince(stuckSince: string | null): string {
  if (stuckSince === null) {
    return "an unknown time";
  }
  return new Date(stuckSince).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Async Server Component — the one export both pages mount. Builds the
 * session-scoped client (RLS applies, T-06-01 precedent — never the
 * secret-key writer), reads `fetchFreshnessStripData`, and throws on its
 * error so the enclosing `TileErrorBoundary label="Freshness"` catches it
 * (UI-SPEC E1 error state). The nested `Suspense` boundary each page wraps
 * this in is what makes this component meaningful on its own.
 */
export async function FreshnessStripSection() {
  const supabase = await createClient();
  const { items, stuckCount, stuckSince, error } = await fetchFreshnessStripData(supabase);

  if (error) {
    throw error instanceof Error ? error : new Error("Freshness read failed");
  }

  return <FreshnessStrip items={items} stuckCount={stuckCount} stuckSince={stuckSince} />;
}

/** Loading state — a Card with a sentence-height placeholder bar (always
 * shown; loading cannot yet know whether the inbox line applies, UI-SPEC
 * E1) plus six skeleton chips in the same grid shape. */
export function FreshnessStripSkeleton() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-5 w-64" />
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-24" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
