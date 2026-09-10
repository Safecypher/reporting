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

const DEFAULT_EMPTY_MESSAGE = "No changes yet — these are the original tiers.";

/**
 * AuditLog — presentational list of *_audit rows (D-06/D-13). Receives
 * entries as props; does not fetch (the page Server Component reads the
 * audit table via the session-scoped client).
 *
 * `emptyMessage` is optional so /settings/pricing renders byte-identically
 * (its call site passes no prop and gets the original pricing copy);
 * /settings/general (05-03) passes its own FY-specific empty copy.
 */
export function AuditLog({
  entries,
  emptyMessage = DEFAULT_EMPTY_MESSAGE,
}: {
  entries: AuditLogEntry[];
  emptyMessage?: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium text-foreground">Change history</h2>

      {entries.length === 0 ? (
        <p className="text-sm font-light text-muted-foreground">
          {emptyMessage}
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
