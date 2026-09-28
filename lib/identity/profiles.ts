import type { createClient } from "@/lib/supabase/server";

/**
 * Server-side actor-id -> email resolver, backed by the `profiles` table
 * migration 0045 introduced (id, email mirrored from `auth.users`, synced
 * by the hourly `refresh-profiles` pg_cron job -- see
 * `.planning/phases/09-automated-drop-off-push-credentials-drain/09-06-TASK2-RECORD.md`
 * for why a cron job rather than a trigger: `auth.users` is owned by
 * `supabase_auth_admin`, and no route into this database -- MCP, SQL
 * editor, or CLI migration -- can create a trigger there). Follows
 * `lib/settings/alignment-settings.ts`'s discriminated-result convention
 * and its `Awaited<ReturnType<typeof createClient>>` client parameter type.
 *
 * A failed or incomplete resolution degrades to the unresolved label rather
 * than throwing or escalating: a missing identity must not take a page to
 * its error state, and the unresolved label is an honest statement that the
 * identity is unknown. This deliberately does not carry `fetchAlignmentSettings`'s
 * (WR-03) concern about a silent default being indistinguishable from a real
 * configured value -- there is no equivalent "looks valid but isn't" failure
 * mode for an actor label.
 */

/** A resolved set of actor ids to their email, keyed by `profiles.id`. */
export type ActorEmailMap = ReadonlyMap<string, string>;

/** Shared empty map for the no-ids and error paths, so no caller has to
 * construct one of its own. */
export const EMPTY_ACTOR_EMAILS: ActorEmailMap = new Map();

/** The single home for the unresolved-actor copy. It was once a bare
 * string literal duplicated across `/settings/general`,
 * `/settings/pricing` and `/settings/senders` (`row.changed_by ??
 * "Unknown user"`); 09-07 migrated all three onto this constant, so this
 * is now the only place the wording lives. Change it here and every
 * surface follows. */
export const UNKNOWN_ACTOR_LABEL = "Unknown user";

type ProfileRow = {
  id: string;
  email: string | null;
};

/**
 * Resolves a list of actor ids (e.g. `ingested_files.uploaded_by`, or any
 * of the three `*_audit.changed_by` columns) to their emails via
 * `profiles`. Never throws: on a query error it logs the raw error
 * server-side and returns the empty map with a non-null `error` string,
 * exactly like `fetchAlignmentSettings`'s error path.
 *
 * Drops null/undefined ids and dedupes to a `Set` before querying -- the
 * dedupe is load-bearing, not cosmetic: an id list built from every row on
 * a page (e.g. every upload) scales with the table, while the distinct
 * actor set does not, so deduping keeps the `in` filter bounded by users
 * rather than rows. An empty (post-dedupe) id list returns immediately
 * without querying at all, so a page with no rows never makes a pointless
 * round trip.
 */
export async function fetchActorEmails(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: readonly (string | null | undefined)[],
): Promise<{ emails: ActorEmailMap; error: string | null }> {
  const uniqueIds = new Set<string>();
  for (const id of ids) {
    if (id) uniqueIds.add(id);
  }

  if (uniqueIds.size === 0) {
    return { emails: EMPTY_ACTOR_EMAILS, error: null };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email")
    .in("id", [...uniqueIds]);

  if (error) {
    console.error("fetchActorEmails: profiles query failed", error);
    return { emails: EMPTY_ACTOR_EMAILS, error: error.message };
  }

  const emails = new Map<string, string>();
  for (const row of (data ?? []) as ProfileRow[]) {
    // A null email (phone-only sign-up, or a row not yet synced with an
    // email) is skipped rather than mapped to an empty string -- absence
    // from the map is the resolver's one unresolved signal, and an empty
    // string would silently satisfy a `.get()` truthiness check elsewhere.
    if (row.email) {
      emails.set(row.id, row.email);
    }
  }

  return { emails, error: null };
}

/**
 * The display label for an actor id: the resolved email, or
 * `UNKNOWN_ACTOR_LABEL` when the id is null/undefined, or when it is
 * absent from the map -- which covers a null email, an id not yet synced
 * by the hourly cron job, and a failed `fetchActorEmails` read alike.
 * Never returns the raw id: a uuid on screen reads as a bug to the three
 * people who use this tool, which is precisely the complaint G-09-1
 * records against `/settings/pricing`.
 */
export function actorLabel(
  id: string | null | undefined,
  emails: ActorEmailMap,
): string {
  if (!id) return UNKNOWN_ACTOR_LABEL;
  return emails.get(id) ?? UNKNOWN_ACTOR_LABEL;
}
