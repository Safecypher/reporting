import { Suspense } from "react";
import type { Metadata } from "next";

import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { createClient } from "@/lib/supabase/server";
import { pushTable } from "@/lib/push/tables";
import { CredentialsTable } from "@/components/settings/credentials-table";
import { MintCredentialForm } from "@/components/settings/mint-credential-form";
import { RevokeCredential } from "@/components/settings/revoke-credential";
import { AuditLog, type AuditLogEntry } from "@/components/pricing/audit-log";
import {
  distinctSenders,
  isSoleLiveCredential,
  type PushCredentialRow,
} from "@/lib/push/credentials";

export const metadata: Metadata = {
  title: "Push credentials — Safecypher Reporting",
};

type PushCredentialAuditRow = {
  id: number;
  changed_by: string | null;
  changed_at: string;
  summary: string;
};

const AUDIT_ROW_CAP = 50;

function PageHeader() {
  return (
    <div className="flex flex-col gap-2 border-b border-border pb-4">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">
        Settings
      </p>
      <h1 className="text-2xl font-medium text-foreground">
        Push credentials
      </h1>
      <p className="max-w-2xl text-sm font-light text-muted-foreground">
        Issue and revoke the per-sender credentials TSYS and Bit Addict use to
        push report files to the inbox — no SQL console required.
      </p>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-border bg-destructive/5 p-12 text-center">
      <svg aria-hidden="true" className="size-8 text-destructive">
        <use href="/icons.svg#alert" />
      </svg>
      <h2 className="text-lg font-medium text-foreground">
        Push credentials could not be loaded
      </h2>
      <p className="max-w-md text-sm font-light text-muted-foreground">
        Try refreshing the page.
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 border-b border-border pb-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-96" />
      </div>
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-[420px] w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

/**
 * Async Server Component reading `push_credentials` +
 * `push_credentials_audit` via the SESSION-SCOPED client (RLS:
 * authenticated select/insert/update, L-04 "audit, not restriction" shape —
 * see 09-01's migration). Both tables predate `types/db.ts`'s regeneration
 * (plan 09-05's task), so both reads go through `lib/push/tables.ts`'s
 * `pushTable` escape hatch rather than `supabase.from(...)` directly.
 *
 * The mint-form section below is a placeholder in this task — Task 3 fills
 * it with `MintCredentialForm`, passing the distinct existing sender names
 * for the suggestion-chip row, and wires each live row's Revoke control.
 */
async function SendersBody() {
  const supabase = await createClient();

  const [credentialsResult, auditResult] = await Promise.all([
    pushTable(supabase, "push_credentials").select(
      "id, sender, token_prefix, created_at, last_used_at, revoked_at",
    ) as Promise<{
      data: PushCredentialRow[] | null;
      error: { message: string } | null;
    }>,
    pushTable(supabase, "push_credentials_audit")
      .select("id, changed_by, changed_at, summary")
      .order("changed_at", { ascending: false })
      .limit(AUDIT_ROW_CAP) as Promise<{
      data: PushCredentialAuditRow[] | null;
      error: { message: string } | null;
    }>,
  ]);

  if (credentialsResult.error || auditResult.error) {
    return (
      <>
        <PageHeader />
        <ErrorState />
      </>
    );
  }

  const credentialRows = credentialsResult.data ?? [];
  const auditRows = auditResult.data ?? [];
  const entries: AuditLogEntry[] = auditRows.map((row) => ({
    id: row.id,
    actor: row.changed_by ?? "Unknown user",
    summary: row.summary,
    changedAt: row.changed_at,
  }));

  const atCap = auditRows.length === AUDIT_ROW_CAP;

  return (
    <>
      <PageHeader />

      <MintCredentialForm existingSenders={distinctSenders(credentialRows)} />

      <Separator />

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-medium text-foreground">
            Credentials
          </h2>
          <p className="max-w-2xl text-sm font-light text-muted-foreground">
            Every credential ever issued, live or revoked — a sender may hold
            more than one live credential during a rotation.
          </p>
        </div>
        <CredentialsTable
          rows={credentialRows}
          renderAction={(credential) => (
            <RevokeCredential
              credentialId={credential.id}
              sender={credential.sender}
              prefix={credential.token_prefix}
              isSoleLive={isSoleLiveCredential(credentialRows, credential.id)}
            />
          )}
        />
      </div>

      <Separator />

      <div className="flex flex-col gap-2">
        <AuditLog
          entries={entries}
          emptyMessage="No credential changes yet."
        />
        {atCap && (
          <p className="text-xs font-light text-muted-foreground">
            Showing the {AUDIT_ROW_CAP} most recent changes.
          </p>
        )}
      </div>
    </>
  );
}

export default function SendersPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <Suspense fallback={<LoadingState />}>
        <SendersBody />
      </Suspense>
    </div>
  );
}
