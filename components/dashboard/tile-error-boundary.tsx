"use client";

import { catchError, type ErrorInfo } from "next/error";

import { Button } from "@/components/ui/button";

/**
 * Component-level error boundary (T-06-34) used to isolate a single home-page
 * region (the alignment strip, or one of the three headline KPI tiles) so a
 * failed read in one region cannot blank its neighbours.
 *
 * `error.tsx` wraps a route SEGMENT and its nested children — it cannot give
 * per-region isolation within a single page
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md).
 * `app/(dashboard)/error.tsx` remains completely unchanged and stays the
 * outer safety net for a total page failure this boundary does not catch.
 * This boundary uses Next 16's component-level `catchError` API instead
 * (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/catchError.md
 * — "enabling component-level error recovery anywhere in your component
 * tree"), stable since v16.3.0 (this project runs 16.3.1) — never a
 * hand-rolled class-component boundary, which would re-invent what the
 * framework now ships and would not correctly pass through `redirect()`/
 * `notFound()` internals.
 *
 * The fallback mirrors `app/(dashboard)/error.tsx`'s visual/copy convention
 * (destructive icon, muted light-weight body text, outline "Try again"
 * button), scaled down to a tile-sized region. It names only the failed
 * region via the `label` prop (T-06-35 — never raw error text/stack), and its
 * retry affordance calls `retry()` (re-fetches and re-renders), not `reset()`
 * (which would only clear the error state without re-fetching).
 */
function TileErrorFallback(props: { label: string }, { retry }: ErrorInfo) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-destructive/5 p-6 text-center">
      <svg aria-hidden="true" className="size-6 text-destructive">
        <use href="/icons.svg#alert" />
      </svg>
      <p className="text-sm font-light text-muted-foreground">
        {props.label} could not be loaded.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={() => retry()}>
        Try again
      </Button>
    </div>
  );
}

/**
 * Usage: `<TileErrorBoundary label="Live cards">{children}</TileErrorBoundary>`
 * Wrap each of the home page's four independent regions (the alignment strip
 * and the three headline KPI tiles) with its own instance so one region's
 * failure degrades that region only.
 */
export const TileErrorBoundary = catchError(TileErrorFallback);
