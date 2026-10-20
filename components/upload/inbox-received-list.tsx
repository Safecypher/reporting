import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RECEIVED_EXPLANATION, RECEIVED_HEADING, type ReceivedInboxRow } from "@/lib/upload/inbox-received";

/**
 * The "Received, not yet processed" block on /uploads (Phase 14, D-10).
 *
 * Presentational and server-compatible: it takes already-built rows, fetches
 * nothing and holds no client of any kind -- the listing runs in the server
 * page, which owns the one privileged read. Renders nothing for an empty list,
 * so the page is unchanged when the inbox holds no unclaimed upload.
 *
 * The received time is formatted in the team's own zone rather than the
 * server's default (UTC on the host), which would read an hour out through
 * British summer time.
 */
export function InboxReceivedList({ rows }: { rows: ReceivedInboxRow[] }) {
  if (rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="received-uploads-heading">
      <div className="flex flex-col gap-1">
        <h2 id="received-uploads-heading" className="text-lg font-medium text-foreground">
          {RECEIVED_HEADING}
        </h2>
        <p className="text-sm font-light text-muted-foreground">{RECEIVED_EXPLANATION}</p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>File</TableHead>
            <TableHead>Uploaded by</TableHead>
            <TableHead>Received</TableHead>
            <TableHead>Waiting</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell className="font-mono text-xs">{row.fileName}</TableCell>
              <TableCell className="text-sm font-light text-foreground">{row.uploaderLabel}</TableCell>
              <TableCell className="text-sm font-light text-muted-foreground">
                {new Date(row.receivedAt).toLocaleString("en-GB", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "Europe/London",
                })}
              </TableCell>
              <TableCell className="text-sm font-light text-muted-foreground">{row.waitingCaption}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
