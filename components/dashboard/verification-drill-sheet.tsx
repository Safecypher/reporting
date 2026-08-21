"use client";

import { DrillSheet } from "@/components/dashboard/drill-sheet";
import { verificationDrillColumns } from "@/components/dashboard/verification-drill-columns";
import type { DrillFilter } from "@/lib/dashboard/drill-params";
import type { VerificationDrillRow } from "@/lib/dashboard/verification-drill";

interface VerificationDrillSheetProps {
  filter: DrillFilter | null;
  rows: VerificationDrillRow[];
  title: string;
  totalCount?: number | null;
}

/**
 * Client wrapper owning the function-bearing `verificationDrillColumns` so
 * they never have to cross the Server -> Client Component boundary as a
 * prop (Next 16 cannot serialize functions). Server pages pass only
 * serializable data (rows/filter/title/totalCount); the columns originate
 * here, in client code.
 */
export function VerificationDrillSheet({
  filter,
  rows,
  title,
  totalCount,
}: VerificationDrillSheetProps) {
  return (
    <DrillSheet
      filter={filter}
      rows={rows}
      columns={verificationDrillColumns}
      title={title}
      totalCount={totalCount}
    />
  );
}
