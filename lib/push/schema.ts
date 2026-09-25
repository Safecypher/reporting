import { z } from "zod";

/**
 * Single source of truth for the /settings/senders mint/revoke forms,
 * imported by BOTH the client forms (components/settings/mint-credential-form.tsx,
 * components/settings/revoke-credential.tsx) and the Server Actions
 * (app/(dashboard)/settings/senders/actions.ts) -- per this codebase's
 * established convention (lib/settings/schema.ts, lib/pricing/schema.ts):
 * client-side validation is UX only, the server always re-validates
 * untrusted input against this same schema.
 */

const SENDER_NAME_REQUIRED_MESSAGE = "Enter a sender name.";
const SENDER_NAME_TOO_LONG_MESSAGE =
  "Sender name must be 100 characters or fewer.";
const CREDENTIAL_ID_MESSAGE = "Invalid credential id.";

export const mintCredentialSchema = z.object({
  sender: z
    .string()
    .trim()
    .min(1, { message: SENDER_NAME_REQUIRED_MESSAGE })
    .max(100, { message: SENDER_NAME_TOO_LONG_MESSAGE }),
});

export type MintCredentialInput = z.infer<typeof mintCredentialSchema>;

export const revokeCredentialSchema = z.object({
  id: z.uuid({ message: CREDENTIAL_ID_MESSAGE }),
});

export type RevokeCredentialInput = z.infer<typeof revokeCredentialSchema>;
