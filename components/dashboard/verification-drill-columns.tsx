import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";

import type { VerificationDrillRow } from "@/lib/dashboard/verification-drill";

/**
 * Shared TanStack Table column defs for the "verification" drill entity
 * (WR-04) — previously duplicated verbatim between verifications/page.tsx
 * and revenue/page.tsx.
 */
const verificationColumnHelper = createColumnHelper<VerificationDrillRow>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches DrillSheet's ColumnDef<TRow, any> prop shape.
export const verificationDrillColumns: ColumnDef<VerificationDrillRow, any>[] = [
  verificationColumnHelper.accessor("created_at", {
    header: "Time",
    cell: (info) =>
      new Date(info.getValue()).toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
  }),
  verificationColumnHelper.accessor("external_card_reference", {
    header: "Card reference",
    cell: (info) => <span className="font-mono tabular-nums">{info.getValue()}</span>,
  }),
  verificationColumnHelper.accessor("duration_ms", {
    header: "Duration (ms)",
    cell: (info) => (
      <span className="font-mono tabular-nums">{info.getValue().toLocaleString()}</span>
    ),
  }),
  verificationColumnHelper.accessor("authenticated", {
    header: "Authenticated",
    cell: (info) => (info.getValue() ? "Yes" : "No"),
  }),
];
