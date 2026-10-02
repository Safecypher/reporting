import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatLastUsed,
  isLiveCredential,
  rotatingSenders,
  sortCredentials,
  type PushCredentialRow,
} from "@/lib/push/credentials";

function formatCreatedAt(createdAt: string): string {
  return new Date(createdAt).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * CredentialsTable — one row per credential (D-02: NEVER collapsed to one
 * row per sender), presentational only. Every ordering/grouping/status rule
 * is computed by the Task 1 pure functions in `lib/push/credentials.ts` —
 * this component renders their output, it does not invent its own rule
 * logic.
 *
 * `renderAction` is optional and rendered only on live rows (the action
 * cell is empty, not a disabled control, on a revoked row). Task 2 leaves
 * it unpassed — the actual Revoke control (`components/settings/
 * revoke-credential.tsx`) does not exist yet and is wired in by Task 3's
 * page.tsx change, not by editing this file again.
 *
 * Deliberately NO cap and NO pagination on this table: a cap here could hide
 * a Live credential, the one row an operator must never miss. This differs
 * from the audit log below it, where a 50-row cap is safe because old rows
 * are inert.
 */
export function CredentialsTable({
  rows,
  renderAction,
  emptyTitle = "No push credentials yet",
  emptyBody = "Issue one to let TSYS or Bit Addict push reports automatically, without anyone downloading email attachments.",
}: {
  rows: PushCredentialRow[];
  renderAction?: (credential: PushCredentialRow) => React.ReactNode;
  /**
   * The default empty state says "none have ever been issued", which is a
   * lie when revoked rows exist and are merely hidden (quick-261002-po6).
   * The caller knows which case it is, so it supplies the wording.
   */
  emptyTitle?: string;
  emptyBody?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-12 text-center">
        <h2 className="text-lg font-medium text-foreground">{emptyTitle}</h2>
        <p className="max-w-md text-sm font-light text-muted-foreground">
          {emptyBody}
        </p>
      </div>
    );
  }

  const sortedRows = sortCredentials(rows);
  const rotating = rotatingSenders(rows);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Sender</TableHead>
          <TableHead>Prefix</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Last used</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">{/* action */}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedRows.map((credential) => {
          const live = isLiveCredential(credential);
          const lastUsed = formatLastUsed(credential.last_used_at);

          return (
            <TableRow key={credential.id}>
              <TableCell>
                <span
                  className="inline-block max-w-[200px] truncate align-middle"
                  title={credential.sender}
                >
                  {credential.sender}
                </span>
                {rotating.has(credential.sender) && live && (
                  <Badge
                    variant="outline"
                    className="ml-1.5 border-border bg-muted text-muted-foreground align-middle"
                  >
                    Rotating
                  </Badge>
                )}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {credential.token_prefix}…
              </TableCell>
              <TableCell className="text-sm font-light text-muted-foreground">
                {formatCreatedAt(credential.created_at)}
              </TableCell>
              <TableCell className="text-sm font-light text-muted-foreground">
                {lastUsed ?? (
                  <span className="italic text-muted-foreground">
                    Never used yet
                  </span>
                )}
              </TableCell>
              <TableCell>
                {live ? (
                  <Badge
                    variant="outline"
                    className="border-[color:var(--success)]/30 bg-[color:var(--success)]/10 text-[color:var(--success)]"
                  >
                    Live
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="border-border bg-muted text-muted-foreground"
                  >
                    Revoked
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-right">
                {live && renderAction ? renderAction(credential) : null}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
