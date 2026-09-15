import { DrillableMetric } from "@/components/dashboard/drillable-metric";
import { SourceDeltaPhrase } from "@/components/dashboard/source-delta-phrase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

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

/**
 * D-16/D-17: everything the "Projected month-end"/"Projected year-end" card
 * renders, all of it pre-computed by the Server Component — this component
 * never calls a formatter, never reads a clock, and never decides whether it
 * should exist (that is the page's D-12 gate, expressed as a nullable prop
 * on `RevenueKpiCards`, not a condition inside this file).
 *
 * `point`/`bandSentence`/`methodCaption` are the populated-state fields,
 * null together whenever `degradedMessage` is non-null (D-14) or `error` is
 * true — the caller resolves that precedence before constructing this
 * object; this component just renders whichever non-null fields it is
 * given, in a fixed choose-one-of-three order (error, then degraded, then
 * populated).
 */
export interface RevenueProjection {
  eyebrow: string;
  point: number | null;
  bandSentence: string | null;
  methodCaption: string | null;
  degradedMessage: string | null;
  error: boolean;
}

interface RevenueKpiCardsProps {
  /** Bit Addict headline + TSYS secondary figure, both pre-summed by the
   * SQL view — never a client-side re-sum. */
  actual: RevenueActualPair;
  /** D-12: null for any period that is not the current month/year — the
   * absent case, never an object with null fields. When present, the two
   * cards render side by side; when null, the actual card alone occupies
   * its normal width. */
  projection: RevenueProjection | null;
}

/**
 * "Projected month-end"/"Projected year-end" card (D-16/D-17). The shell —
 * `border-dashed`, tinted `--provisional-border`/`--provisional-bg` — is
 * identical across all three inner states (populated, degraded, error) so a
 * viewer always recognises which card this is, even when it has nothing to
 * show yet. The point figure is deliberately the 20px "secondary numeric"
 * size, not the 48px hero, in `--provisional` ink — never `--fg-3`/
 * `--cypher-ink-50`, which fails WCAG AA at this size/weight. Not
 * drillable: a projection has no contributing rows (some of the days it
 * rests on have not happened yet), so no `DrillableMetric` wrapper is used
 * anywhere on this card.
 */
function RevenueProjectedCard({ projection }: { projection: RevenueProjection }) {
  const { eyebrow, point, bandSentence, methodCaption, degradedMessage, error } = projection;

  return (
    <Card className="border-dashed border-[var(--provisional-border)] bg-[var(--provisional-bg)]">
      <CardHeader>
        <CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {eyebrow}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {error ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <svg aria-hidden="true" className="size-6 text-destructive">
              <use href="/icons.svg#alert" />
            </svg>
            <p className="text-sm font-light text-muted-foreground">
              {eyebrow} could not be loaded.
            </p>
          </div>
        ) : degradedMessage !== null ? (
          <p className="text-sm font-medium text-[var(--fg-2)]">{degradedMessage}</p>
        ) : (
          <>
            {point !== null && (
              <span className="font-mono text-[20px] font-bold tabular-nums text-[var(--provisional)]">
                {formatCurrency(point)}
              </span>
            )}
            {bandSentence !== null && (
              <p className="text-sm font-medium text-[var(--fg-2)]">{bandSentence}</p>
            )}
            {methodCaption !== null && (
              <p className="text-xs font-light text-[var(--fg-3)]">{methodCaption}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Loading state for the projected card — independent of the actual card's
 * own skeleton, so a slow forecast query never blocks the actual figure
 * from appearing (07-UI-SPEC E1). Same dashed provisional shell as every
 * other state of this card. */
export function RevenueProjectionCardSkeleton() {
  return (
    <Card className="border-dashed border-[var(--provisional-border)] bg-[var(--provisional-bg)]">
      <CardHeader>
        <Skeleton className="h-3 w-32" />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-3 w-3/4" />
      </CardContent>
    </Card>
  );
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
 * Aesthetic point 2). Beneath it, the shared `SourceDeltaPhrase` (07-03)
 * renders the which-side-is-short variance phrase — the SAME
 * implementation `/alignment`'s cards use, formatted as currency — so the
 * phrase grammar has exactly one implementation across both pages. It is
 * omitted entirely when the TSYS figure could not be loaded, since a
 * variance against a missing number is meaningless.
 */
export function RevenueKpiCards({ actual, projection }: RevenueKpiCardsProps) {
  const { bitAddict, tsys, tsysError } = actual;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              <>
                <span className="font-mono text-sm font-bold tabular-nums text-[var(--fg-2)]">
                  {formatCurrency(tsys)}
                </span>
                <p className="text-sm font-medium text-[var(--fg-2)]">
                  <SourceDeltaPhrase
                    tsysValue={tsys}
                    bitAddictValue={bitAddict}
                    formatValue={formatCurrency}
                  />
                </p>
              </>
            )}
          </div>
        </CardContent>
      </Card>
      {projection && <RevenueProjectedCard projection={projection} />}
    </div>
  );
}
