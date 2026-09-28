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
 * RED-phase stub (Task 3 TDD cycle, plan 09-06): both exports below return
 * an unconditionally unresolved result. GREEN implements the real
 * `profiles` read.
 */

/** A resolved set of actor ids to their email, keyed by `profiles.id`. */
export type ActorEmailMap = ReadonlyMap<string, string>;

/** Shared empty map for the no-ids and error paths, so no caller has to
 * construct one of its own. */
export const EMPTY_ACTOR_EMAILS: ActorEmailMap = new Map();

/** The single home for the unresolved-actor copy, today a bare string
 * literal duplicated across `/settings/general`, `/settings/pricing` and
 * `/settings/senders` (`row.changed_by ?? "Unknown user"`). Those three
 * call sites are not touched by this plan -- migrating them is 09-07's
 * job. */
export const UNKNOWN_ACTOR_LABEL = "Unknown user";

/**
 * Resolves a list of actor ids (e.g. `ingested_files.uploaded_by`, or any
 * of the three `*_audit.changed_by` columns) to their emails via
 * `profiles`. STUB -- always returns the empty map, never queries.
 */
export async function fetchActorEmails(
  _supabase: Awaited<ReturnType<typeof createClient>>,
  _ids: readonly (string | null | undefined)[],
): Promise<{ emails: ActorEmailMap; error: string | null }> {
  return { emails: EMPTY_ACTOR_EMAILS, error: null };
}

/**
 * The display label for an actor id. STUB -- always returns
 * `UNKNOWN_ACTOR_LABEL`.
 */
export function actorLabel(
  _id: string | null | undefined,
  _emails: ActorEmailMap,
): string {
  return UNKNOWN_ACTOR_LABEL;
}
