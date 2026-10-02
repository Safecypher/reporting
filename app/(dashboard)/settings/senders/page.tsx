import { Suspense } from "react";
import type { Metadata } from "next";

import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { createClient } from "@/lib/supabase/server";
import { pushTable } from "@/lib/push/tables";
import { CredentialsTable } from "@/components/settings/credentials-table";
import { MintCredentialForm } from "@/components/settings/mint-credential-form";
import { EndpointInstructions } from "@/components/settings/endpoint-instructions";
import { pushEndpointUrl } from "@/lib/push/endpoint";
import { RevokeCredential } from "@/components/settings/revoke-credential";
import { AuditLog, type AuditLogEntry } from "@/components/pricing/audit-log";
import { actorLabel, fetchActorEmails } from "@/lib/identity/profiles";
import {
  distinctSenders,
  isSoleLiveCredential,
  partitionByRevoked,
  type PushCredentialRow,
} from "@/lib/push/credentials";
import Link from "next/link";

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
 * `MintCredentialForm` receives the distinct existing sender names for its
 * suggestion-chip row; each live row's `RevokeCredential` control receives
 * that credential's sole-live flag from Task 1's `isSoleLiveCredential`.
 */
async function SendersBody({ showRevoked }: { showRevoked: boolean }) {
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

  // A necessary third round trip rather than a third Promise.all entry — the
  // actor ids aren't known until auditRows is derived above. Its error is
  // deliberately kept out of the combined error branch above: losing an
  // email is not losing a row, so the audit list still renders with the
  // unresolved fallback rather than the whole page's error state.
  const { emails: actorEmails, error: actorEmailsError } = await fetchActorEmails(
    supabase,
    auditRows.map((row) => row.changed_by),
  );
  if (actorEmailsError) {
    console.error("SendersBody: fetchActorEmails failed", actorEmailsError);
  }

  const entries: AuditLogEntry[] = auditRows.map((row) => ({
    id: row.id,
    actor: actorLabel(row.changed_by, actorEmails),
    summary: row.summary,
    changedAt: row.changed_at,
  }));

  const atCap = auditRows.length === AUDIT_ROW_CAP;

  // Resolved here rather than in the client components so the value comes
  // from the server's own environment. Null when NEXT_PUBLIC_SITE_URL is
  // unset, which the panel renders as a fix-this notice rather than a
  // half-built URL a sender might paste and try.
  const endpointUrl = pushEndpointUrl(process.env.NEXT_PUBLIC_SITE_URL);

  // Revoked credentials are hidden by default: they accumulate forever and
  // nothing can be done with them. They are NEVER deleted — `push_credentials`
  // is referenced by `ingested_files.source_credential_id` and
  // `push_rejections.credential_id`, both ON DELETE NO ACTION, because a
  // credential is the provenance record for every file it delivered. Two rows
  // that read as throwaway tests delivered real 26-27 September verification
  // data (quick-261002-po6).
  const { live: liveCredentials, revoked: revokedCredentials } =
    partitionByRevoked(credentialRows);
  const visibleCredentials = showRevoked ? credentialRows : liveCredentials;

  return (
    <>
      <PageHeader />

      <MintCredentialForm
        existingSenders={distinctSenders(credentialRows)}
        endpointUrl={endpointUrl}
      />

      <Separator />

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-medium text-foreground">
            What to send a sender
          </h2>
          <p className="max-w-2xl text-sm font-light text-muted-foreground">
            The details a sender needs to integrate. These stay readable —
            unlike the token, which is shown once when it is issued and cannot
            be retrieved afterwards.
          </p>
        </div>
        <EndpointInstructions endpointUrl={endpointUrl} />
      </div>

      <Separator />

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-medium text-foreground">
            Credentials
          </h2>
          <p className="max-w-2xl text-sm font-light text-muted-foreground">
            {showRevoked
              ? "Every credential ever issued, live and revoked — a sender may hold more than one live credential during a rotation."
              : "Live credentials — a sender may hold more than one during a rotation."}
          </p>
        </div>
        <CredentialsTable
          rows={visibleCredentials}
          emptyTitle={
            revokedCredentials.length > 0
              ? "No live credentials"
              : "No push credentials yet"
          }
          emptyBody={
            revokedCredentials.length > 0
              ? `Every credential issued so far has been revoked. Issue one to let TSYS or Bit Addict push reports automatically. ${revokedCredentials.length} revoked credential${revokedCredentials.length === 1 ? " is" : "s are"} hidden — they are kept because each one is the provenance record for the files it delivered.`
              : "Issue one to let TSYS or Bit Addict push reports automatically, without anyone downloading email attachments."
          }
          renderAction={(credential) => (
            <RevokeCredential
              credentialId={credential.id}
              sender={credential.sender}
              prefix={credential.token_prefix}
              isSoleLive={isSoleLiveCredential(credentialRows, credential.id)}
            />
          )}
        />
        {revokedCredentials.length > 0 && (
          <div>
            <Link
              href={
                showRevoked
                  ? "/settings/senders"
                  : "/settings/senders?revoked=1"
              }
              className="text-sm font-light text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              {showRevoked
                ? "Hide revoked credentials"
                : `Show ${revokedCredentials.length} revoked credential${revokedCredentials.length === 1 ? "" : "s"}`}
            </Link>
          </div>
        )}
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

export default async function SendersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const showRevoked = firstValue(params.revoked) === "1";

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <Suspense fallback={<LoadingState />}>
        <SendersBody showRevoked={showRevoked} />
      </Suspense>
    </div>
  );
}

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
