"use client";

import { Badge } from "@/components/ui/badge";
import type { ReconciliationStatus } from "@/lib/dashboard/reconciliation-status";

/**
 * Shared 4-state reconciliation badge (D-09). Colour is switched purely on
 * the `status` enum computed by the SQL views (mirroring
 * `lib/dashboard/reconciliation-status.ts`) — never inferred from delta
 * sign/magnitude in this component (UI-SPEC binding rule).
 *
 * Extends the precedent in components/upload/uploads-history-table.tsx
 * (2-state done/failed) to the 4-state ok/needs_review/mismatch/
 * no_source_data set needed by both reconciliation section tables.
 */
export function StatusBadge({ status }: { status: ReconciliationStatus }) {
  if (status === "ok") {
    return (
      <Badge
        variant="outline"
        className="border-[color:var(--success)]/30 bg-[color:var(--success)]/10 text-[color:var(--success)]"
      >
        OK
      </Badge>
    );
  }

  if (status === "needs_review") {
    return (
      <Badge
        variant="outline"
        className="border-[color:var(--warning)]/30 bg-[color:var(--warning)]/10 text-[color:var(--warning)]"
      >
        Needs review
      </Badge>
    );
  }

  if (status === "no_source_data") {
    // Neutral, non-alarm treatment: the text itself carries the meaning for
    // anyone who cannot distinguish the tint (same accessibility reasoning
    // as quick task 260823-l9c) -- never destructive/--warning, since "we
    // don't know" is not an alarm.
    return (
      <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
        No report received
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
      Mismatch
    </Badge>
  );
}
