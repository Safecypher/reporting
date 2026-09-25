"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  mintCredentialSchema,
  type MintCredentialInput,
} from "@/lib/push/schema";
import { issuePushCredential } from "@/app/(dashboard)/settings/senders/actions";
import {
  TokenRevealDialog,
  type TokenReveal,
} from "@/components/settings/token-reveal-dialog";

const MINT_FAILURE_FALLBACK_MESSAGE = "Enter a sender name.";

/**
 * MintCredentialForm — the /settings/senders mint control (D-01/D-04/D-05).
 * Mirrors `components/settings/fy-settings-form.tsx`'s react-hook-form +
 * zodResolver shape; validates on submit, not per keystroke (RHF's default
 * mode). `useTransition`'s pending state disables the submit button, the
 * same pattern `delete-tier-set.tsx` uses for its own destructive action.
 *
 * On success, hands the returned token/prefix/sender to
 * `TokenRevealDialog` — the only place the complete token exists outside
 * `issuePushCredential`'s own return value — and clears the field only
 * after that hand-off. A failed mint keeps the typed sender name so it can
 * be retried without re-typing.
 */
export function MintCredentialForm({
  existingSenders,
}: {
  existingSenders: string[];
}) {
  const [isPending, startTransition] = useTransition();
  const [reveal, setReveal] = useState<TokenReveal | null>(null);

  const form = useForm<MintCredentialInput>({
    resolver: zodResolver(mintCredentialSchema),
    defaultValues: { sender: "" },
  });

  const onSubmit = form.handleSubmit((data) => {
    startTransition(async () => {
      const result = await issuePushCredential(data);

      if ("error" in result) {
        const message =
          typeof result.error === "string"
            ? result.error
            : MINT_FAILURE_FALLBACK_MESSAGE;
        toast.error(message);
        return;
      }

      setReveal({
        token: result.token,
        prefix: result.prefix,
        sender: result.sender,
      });
      form.reset({ sender: "" });
    });
  });

  return (
    <>
      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-4 rounded-lg border border-border p-6"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sender">Sender name</Label>
          <Input id="sender" {...form.register("sender")} />
          {form.formState.errors.sender && (
            <p className="text-xs text-destructive">
              {form.formState.errors.sender.message}
            </p>
          )}
        </div>

        {/* On first use there are no existing credentials, so no chips
            render and the input alone is the whole control — no
            placeholder or hint row. */}
        {existingSenders.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-light text-muted-foreground">
              Use an existing sender name to avoid creating a duplicate
              identity:
            </p>
            <div className="flex flex-wrap gap-2">
              {existingSenders.map((sender) => (
                <Button
                  key={sender}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    form.setValue("sender", sender, {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }
                >
                  {sender}
                </Button>
              ))}
            </div>
          </div>
        )}

        <Button
          type="submit"
          disabled={isPending}
          className="self-start bg-[var(--cypher-blue)] text-white hover:bg-[var(--cypher-blue)]/90"
        >
          {isPending ? "Issuing…" : "Issue credential"}
        </Button>
      </form>

      <TokenRevealDialog reveal={reveal} onAcknowledge={() => setReveal(null)} />
    </>
  );
}
