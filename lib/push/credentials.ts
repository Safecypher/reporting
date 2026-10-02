/**
 * Pure list-presentation rules for /settings/senders (D-02/D-04/AUTO-04).
 *
 * Every rule the credentials table needs to render correctly lives here as a
 * plain function over `PushCredentialRow[]`, so `components/settings/
 * credentials-table.tsx` stays presentational and every rule is
 * unit-testable without a DOM (Task 1's own acceptance criteria).
 *
 * Field names deliberately mirror `push_credentials`'s own columns
 * (snake_case) rather than a camelCase re-shape — the page Server Component
 * selects exactly these columns and passes the rows straight through with no
 * intermediate mapping layer, the same convention
 * `app/(dashboard)/settings/general/page.tsx`'s `AppSettingsAuditRow` uses.
 *
 * Deliberately has NO field for the token digest (`token_sha256`) — the type
 * itself is the reminder that the digest never reaches the browser (D-05,
 * T-09-19). Column-level SELECT on `token_sha256` is revoked from
 * `authenticated` in 09-01's migration, so selecting it here would fail at
 * the database anyway; the type omission is the compile-time backstop.
 */
export interface PushCredentialRow {
  id: string;
  sender: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** A credential is live when its revoked-at is null. */
export function isLiveCredential(row: PushCredentialRow): boolean {
  return row.revoked_at === null;
}

/**
 * Orders rows by sender ascending (en-GB locale collation, not raw code-unit
 * ordering — so "tsys" and "TSYS" sort by their actual alphabetic value, not
 * byte value) then created-at descending within each sender. Stable for
 * equal keys: `Array.prototype.sort` is a stable sort in every JS engine
 * this project runs on (ES2019+), so two rows with an identical sender AND
 * an identical created_at keep their original relative order.
 */
export function sortCredentials(
  rows: PushCredentialRow[],
): PushCredentialRow[] {
  return [...rows].sort((a, b) => {
    const senderCompare = a.sender.localeCompare(b.sender, "en-GB");
    if (senderCompare !== 0) {
      return senderCompare;
    }
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

/**
 * Sender names currently holding two or more LIVE credentials at once. This
 * set drives the "Rotating" badge — D-02's expected healthy overlap during a
 * credential rotation, never an alarm.
 */
export function rotatingSenders(rows: PushCredentialRow[]): Set<string> {
  const liveCountsBySender = new Map<string, number>();

  for (const row of rows) {
    if (isLiveCredential(row)) {
      liveCountsBySender.set(
        row.sender,
        (liveCountsBySender.get(row.sender) ?? 0) + 1,
      );
    }
  }

  const rotating = new Set<string>();
  for (const [sender, liveCount] of liveCountsBySender) {
    if (liveCount >= 2) {
      rotating.add(sender);
    }
  }
  return rotating;
}

/**
 * Given every row and one credential id, is that credential the ONLY live
 * credential for its sender? Drives the escalation line in the revoke
 * confirmation dialog — revoking a sender's sole live credential stops that
 * sender pushing files until a new one is issued.
 */
export function isSoleLiveCredential(
  rows: PushCredentialRow[],
  id: string,
): boolean {
  const target = rows.find((row) => row.id === id);
  if (!target || !isLiveCredential(target)) {
    return false;
  }

  const liveSiblingCount = rows.filter(
    (row) => row.sender === target.sender && isLiveCredential(row),
  ).length;

  return liveSiblingCount === 1;
}

/**
 * Sender names already present in `rows`, de-duplicated by EXACT string
 * equality and sorted (en-GB collation) — feeds the mint form's
 * sender-suggestion chip row. Exact equality is deliberate: "TSYS" and
 * "tsys" are two distinct entries, because `push_credentials.sender` really
 * does treat them as two identities (no unique constraint, D-02, no
 * normalisation) — surfacing both is what lets an operator notice a typo and
 * pick the right existing name instead of retyping and creating a third.
 * Includes senders whose only credentials are revoked: a sender identity
 * that existed once is still worth suggesting over retyping it.
 */
export function distinctSenders(rows: PushCredentialRow[]): string[] {
  const senders = new Set(rows.map((row) => row.sender));
  return Array.from(senders).sort((a, b) => a.localeCompare(b, "en-GB"));
}

/**
 * `en-GB` medium-date/short-time string for a non-null last-used timestamp,
 * or null when the credential has never been used. Returning null (rather
 * than inventing copy like "Never used yet" here) keeps this function a pure
 * formatter — the component decides how to render the null case, per the
 * plan's own separation of formatting from presentation.
 */
export function formatLastUsed(lastUsedAt: string | null): string | null {
  if (lastUsedAt === null) {
    return null;
  }
  return new Date(lastUsedAt).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Splits rows into live and revoked (quick-261002-po6).
 *
 * `/settings/senders` shows live credentials by default, because every
 * credential ever issued accumulates there forever and a revoked one is
 * history rather than something you can act on. Revoked rows stay one click
 * away rather than being deleted: `push_credentials` is referenced by
 * `ingested_files.source_credential_id` and `push_rejections.credential_id`,
 * both `ON DELETE NO ACTION`, because a credential is the provenance record
 * for every file it delivered. Two of the credentials that look like test
 * rows delivered real 26-27 September verification data.
 */
export function partitionByRevoked(rows: PushCredentialRow[]): {
  live: PushCredentialRow[];
  revoked: PushCredentialRow[];
} {
  const live: PushCredentialRow[] = [];
  const revoked: PushCredentialRow[] = [];
  for (const row of rows) {
    (isLiveCredential(row) ? live : revoked).push(row);
  }
  return { live, revoked };
}
