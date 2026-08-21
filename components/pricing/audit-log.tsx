export type AuditLogEntry = {
  id: number;
  actor: string;
  summary: string;
  changedAt: string;
};

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * AuditLog — presentational list of pricing_tier_audit rows (D-06).
 * Receives entries as props; does not fetch (the page Server Component
 * reads pricing_tier_audit via the session-scoped client).
 */
export function AuditLog({ entries }: { entries: AuditLogEntry[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium text-foreground">Change history</h2>

      {entries.length === 0 ? (
        <p className="text-sm font-light text-muted-foreground">
          No changes yet — these are the original tiers.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="border-b border-border pb-2 text-sm font-light text-foreground last:border-none"
            >
              <span>{entry.actor} </span>
              <span>{entry.summary} on </span>
              <span className="font-mono text-xs text-muted-foreground">
                {formatTimestamp(entry.changedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
