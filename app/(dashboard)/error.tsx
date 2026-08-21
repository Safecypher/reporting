"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * Dashboard segment error boundary (CR-02, defense-in-depth).
 *
 * `error.tsx` wraps every page/nested-layout under `app/(dashboard)/` in a
 * React error boundary — it does NOT wrap `app/(dashboard)/layout.tsx`
 * itself, so the sidebar/app shell stays intact and only the page content
 * area falls back to this branded state (Next 16 file-convention: see
 * `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`).
 *
 * This is a safety net, not the primary defence: `lib/dashboard/drill-params.ts`
 * already validates the `date` param so a malformed drill link should never
 * throw in the first place. This boundary exists so that ANY future
 * unhandled render error in a dashboard page degrades to the app's own
 * error copy instead of Next's generic unstyled error page.
 */
export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // Server Component errors are already redacted to a generic message +
    // digest by Next in production (see error.md "error.message"); logging
    // client-side here is best-effort and safe to keep verbose.
    console.error("Dashboard segment error:", error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
      <svg aria-hidden="true" className="size-8 text-destructive">
        <use href="/icons.svg#alert" />
      </svg>
      <h2 className="text-lg font-medium text-foreground">
        Something went wrong
      </h2>
      <p className="max-w-md text-sm font-light text-muted-foreground">
        This page hit an unexpected error
        {error.digest ? ` (ref: ${error.digest})` : ""}. Try again, or head
        back and re-open the page from the sidebar.
      </p>
      <Button type="button" variant="outline" onClick={() => retry()}>
        Try again
      </Button>
    </div>
  );
}
