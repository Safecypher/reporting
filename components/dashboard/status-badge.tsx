"use client";

import { Badge } from "@/components/ui/badge";
import type { ReconciliationStatus } from "@/lib/dashboard/reconciliation-status";

/**
 * Shared 3-state reconciliation badge (D-09). Colour is switched purely on
 * the `status` enum computed by the SQL views (mirroring
 * `lib/dashboard/reconciliation-status.ts`) — never inferred from delta
 * sign/magnitude in this component (UI-SPEC binding rule).
 *
 * Extends the precedent in components/upload/uploads-history-table.tsx
 * (2-state done/failed) to the 3-state ok/needs_review/mismatch set needed
 * by both reconciliation section tables.
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

  return (
    <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
      Mismatch
    </Badge>
  );
}
