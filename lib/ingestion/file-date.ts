/**
 * Extract a `YYYY-MM-DD` report date immediately preceding the file
 * extension (D-02) — used by the card-inventory parser, whose `CreatedAt`
 * column is per-card enrolment time, not the snapshot day. Deliberately
 * does NOT fall back to "today" on a miss: a bad/missing filename date must
 * be a rejected file (see Pitfall 2, 02-RESEARCH.md) rather than a silently
 * wrong snapshot day that corrupts day-over-day reconciliation later.
 */
const FILENAME_DATE = /(\d{4}-\d{2}-\d{2})(?=\.[^.]+$)/;

export function extractReportDateFromFileName(fileName: string): string | null {
  const match = FILENAME_DATE.exec(fileName);
  if (!match) return null;

  const [y, m, d] = match[1].split("-").map(Number);
  // Date.UTC silently rolls over impossible calendar dates (e.g. 2026-13-40)
  // instead of throwing — round-trip the components to reject those.
  const asUtc = new Date(Date.UTC(y, m - 1, d));
  const roundTrips =
    asUtc.getUTCFullYear() === y && asUtc.getUTCMonth() === m - 1 && asUtc.getUTCDate() === d;

  return roundTrips ? match[1] : null;
}
