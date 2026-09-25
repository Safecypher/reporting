/**
 * Untyped-table accessor for `push_credentials` and `drain_lock` (and, when
 * a later plan needs it, `push_credentials_audit`) — the three tables
 * `supabase/migrations/0040_push_delivery_spine.sql` creates that
 * `types/db.ts` does not yet describe, since a subagent executor in this
 * project has no live Supabase MCP access to apply the migration and
 * regenerate types (that happens in plan 09-05).
 *
 * Mirrors the existing untyped-table escape hatch `upsertRows` already
 * carries in `lib/ingestion/supabase-writer.ts`, contained to this one file
 * so every `push_credentials`/`drain_lock` query in the codebase goes
 * through a single documented suppression instead of four scattered ones.
 * Plan 09-05's type regeneration is what retires this file — once
 * `types/db.ts` knows these tables, callers can use `supabase.from(...)`
 * directly and this helper can be deleted.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";

export function pushTable(client: SupabaseClient<Database>, table: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (client as any).from(table);
}

/**
 * Same escape hatch as `pushTable`, for the two `drain_lock` RPC functions
 * (`fn_try_acquire_drain_lock` / `fn_release_drain_lock`) — `types/db.ts`
 * does not yet know their signatures either, since it is regenerated only
 * after plan 09-05 applies this plan's migration live.
 */
export function pushRpc(client: SupabaseClient<Database>, fn: string, args?: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (client as any).rpc(fn, args);
}
