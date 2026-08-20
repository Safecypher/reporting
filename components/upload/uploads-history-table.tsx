import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type IngestedFileRow = {
  id: string;
  file_name: string;
  uploaded_at: string;
  uploaded_by: string | null;
  status: string;
  rows_accepted: number | null;
  rows_duplicate: number | null;
  rows_rejected: number | null;
};

function StatusBadge({ status }: { status: string }) {
  if (status === "done") {
    return (
      <Badge
        variant="outline"
        className="border-[color:var(--success,#0a7a4b)]/30 bg-[color:var(--success,#0a7a4b)]/10 text-[color:var(--success,#0a7a4b)]"
      >
        Done
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Pending
    </Badge>
  );
}

/**
 * Audit-trail table (INGEST-05) reading `ingested_files` ordered by
 * uploaded_at desc. Server-Component-fed — the caller queries the rows and
 * passes them in, keeping this component a pure presentational table.
 */
export function UploadsHistoryTable({ files }: { files: IngestedFileRow[] }) {
  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-12 text-center">
        <p className="text-sm font-light text-muted-foreground">
          No uploads yet. Drag a report file above to get started.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>File</TableHead>
          <TableHead>Uploaded</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Accepted</TableHead>
          <TableHead className="text-right">Duplicates</TableHead>
          <TableHead className="text-right">Rejected</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {files.map((file) => (
          <TableRow key={file.id}>
            <TableCell className="font-mono text-xs">{file.file_name}</TableCell>
            <TableCell className="text-sm font-light text-muted-foreground">
              {new Date(file.uploaded_at).toLocaleString("en-GB", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </TableCell>
            <TableCell>
              <StatusBadge status={file.status} />
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {file.rows_accepted ?? 0}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {file.rows_duplicate ?? 0}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {file.rows_rejected ?? 0}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
