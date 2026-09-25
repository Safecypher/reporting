"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { generateToken } from "@/lib/push/tokens";
import { pushTable } from "@/lib/push/tables";
import {
  mintCredentialSchema,
  revokeCredentialSchema,
} from "@/lib/push/schema";

const MINT_FAILURE_MESSAGE = "Could not issue this credential. Try again.";
const REVOKE_FAILURE_MESSAGE = "Could not revoke this credential. Try again.";
const ALREADY_REVOKED_MESSAGE = "This credential is already revoked.";

type MintSuccess = {
  success: true;
  /**
   * The complete token — this field, and no other path anywhere in this
   * module, is where it exists outside `generateToken()` itself (D-05).
   * Never logged, never put in an error branch, never written anywhere but
   * this one return value, which `mint-credential-form.tsx` hands straight
   * to the one-time reveal dialog.
   */
  token: string;
  prefix: string;
  sender: string;
};

/**
 * issuePushCredential — the /settings/senders mint action (AUTO-04, D-01,
 * D-05). Clones `app/(dashboard)/settings/general/actions.ts`'s
 * `saveFinancialYearSettings` shape object-for-object:
 * - Re-validates `input` with the SAME `mintCredentialSchema` the client
 *   form uses. Client-side validation is UX only — this is an untrusted
 *   entry point.
 * - Uses the SESSION-SCOPED `lib/supabase/server.ts` client, never the
 *   secret-key client. This is load-bearing, not stylistic:
 *   `fn_push_credentials_audit()` reads `auth.uid()`, which is null under
 *   the secret key — an audit row with no actor defeats D-03.
 * - Returns the complete token exactly once. Persists only the digest
 *   (`token_sha256`) and the display prefix (`token_prefix`).
 */
export async function issuePushCredential(
  input: unknown,
): Promise<MintSuccess | { error: string | Record<string, unknown> }> {
  const parsed = mintCredentialSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten() };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Unauthorized" };
  }

  const { token, prefix, hash } = generateToken();

  const { error } = await pushTable(supabase, "push_credentials").insert({
    sender: parsed.data.sender,
    token_sha256: hash,
    token_prefix: prefix,
    created_by: user.id,
  });

  if (error) {
    // Log the raw, detailed error server-side only; the client only ever
    // sees the mapped, friendly message — same convention as
    // saveFinancialYearSettings/saveAlignmentSettings.
    console.error("issuePushCredential: push_credentials insert failed", error);
    return { error: MINT_FAILURE_MESSAGE };
  }

  revalidatePath("/settings/senders");

  return { success: true, token, prefix, sender: parsed.data.sender };
}

/**
 * revokePushCredential — the /settings/senders revoke action (AUTO-04,
 * D-01). Same session-scoped-client / user-guard shape as
 * `issuePushCredential` above. Updates `revoked_at` only where the row is
 * still live (`revoked_at is null`) and inspects the affected rows: a
 * revoke that matches zero rows returns an explicit "already revoked"
 * result rather than a silent success — a revoke that quietly did nothing
 * is exactly the kind of lie this milestone exists to eliminate.
 */
export async function revokePushCredential(
  input: unknown,
): Promise<{ success: true } | { error: string | Record<string, unknown> }> {
  const parsed = revokeCredentialSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten() };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Unauthorized" };
  }

  const { data, error } = await pushTable(supabase, "push_credentials")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .is("revoked_at", null)
    .select("id");

  if (error) {
    console.error("revokePushCredential: push_credentials update failed", error);
    return { error: REVOKE_FAILURE_MESSAGE };
  }

  if (!Array.isArray(data) || data.length === 0) {
    return { error: ALREADY_REVOKED_MESSAGE };
  }

  revalidatePath("/settings/senders");

  return { success: true };
}
