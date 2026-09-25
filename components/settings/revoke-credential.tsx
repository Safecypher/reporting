"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { revokePushCredential } from "@/app/(dashboard)/settings/senders/actions";

const REVOKE_FAILURE_FALLBACK_MESSAGE =
  "Could not revoke this credential. Try again.";

interface RevokeCredentialProps {
  credentialId: string;
  sender: string;
  prefix: string;
  /** True only when this is the sender's sole live credential (Task 1's
   * `isSoleLiveCredential`) — drives the escalation line below. */
  isSoleLive: boolean;
}

/**
 * RevokeCredential — clones `components/pricing/delete-tier-set.tsx`'s
 * controlled-open + `useTransition` + toast-on-error +
 * toast-then-close-on-success pattern exactly. Rendered only on live rows
 * (`credentials-table.tsx`'s `renderAction` gate) — this component itself
 * has no live/revoked branching of its own.
 */
export function RevokeCredential({
  credentialId,
  sender,
  prefix,
  isSoleLive,
}: RevokeCredentialProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await revokePushCredential({ id: credentialId });

      if ("error" in result) {
        const message =
          typeof result.error === "string"
            ? result.error
            : REVOKE_FAILURE_FALLBACK_MESSAGE;
        toast.error(message);
        return;
      }

      toast.success(`Revoked the credential for ${sender} (${prefix}…).`);
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="destructive" size="sm">
          Revoke
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke this credential?</DialogTitle>
          <DialogDescription>
            Any request using {prefix}… will be refused immediately. This
            cannot be undone.
            {isSoleLive && (
              <>
                {" "}
                This is {sender}&apos;s only live credential — revoking it
                will stop {sender} from pushing files until a new one is
                issued.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={isPending}
            onClick={handleConfirm}
          >
            {isPending ? "Revoking…" : "Revoke credential"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
