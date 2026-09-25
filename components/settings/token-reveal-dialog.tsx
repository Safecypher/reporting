"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface TokenReveal {
  token: string;
  prefix: string;
  sender: string;
}

/**
 * TokenRevealDialog — the show-once surface (D-05). The complete token
 * lives only in this component's `reveal` prop for the life of the dialog:
 * it is never written to a ref that outlives the dialog, never put in the
 * URL, never persisted to storage, and never logged.
 *
 * Cannot be dismissed by an outside click or the Escape key — both are
 * explicitly suppressed via `onInteractOutside`/`onEscapeKeyDown`
 * `preventDefault()`, and the default close (`X`) affordance is turned off
 * via `showCloseButton={false}`. The ONLY way to close this dialog is the
 * "I've saved it — done" button, whose phrasing is itself the
 * acknowledgment (never a bare "Close" or an icon) — losing a show-once
 * secret to a stray click is not a recoverable error, so the control
 * surface is deliberately narrowed to one explicit action.
 */
export function TokenRevealDialog({
  reveal,
  onAcknowledge,
}: {
  reveal: TokenReveal | null;
  onAcknowledge: () => void;
}) {
  async function handleCopy() {
    if (!reveal) {
      return;
    }
    try {
      await navigator.clipboard.writeText(reveal.token);
      toast("Token copied");
    } catch {
      // A rejected write (insecure context, denied permission) must never
      // lose the secret — the dialog stays open and the token stays
      // selectable, so a failed copy is recoverable without re-minting.
      toast.error("Copy failed — select the token and copy manually");
    }
  }

  function handleAcknowledge() {
    if (!reveal) {
      return;
    }
    toast.success(`Credential issued for ${reveal.sender}.`);
    onAcknowledge();
  }

  return (
    <Dialog open={reveal !== null} onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        {reveal && (
          <>
            <div className="rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] p-4">
              <DialogHeader>
                <DialogTitle className="text-[color:var(--warning)]">
                  Copy this token now
                </DialogTitle>
                <DialogDescription className="text-[color:var(--warning)]">
                  This is the only time this token will be shown. After you
                  close this, only the prefix ({reveal.prefix}) stays
                  visible — you can replace it later, but you can never view
                  it again.
                </DialogDescription>
              </DialogHeader>
            </div>

            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={reveal.token}
                onFocus={(event) => event.currentTarget.select()}
                className="w-full font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={handleCopy}
              >
                Copy token
              </Button>
            </div>

            <DialogFooter>
              <Button
                type="button"
                className="bg-[var(--cypher-blue)] text-white hover:bg-[var(--cypher-blue)]/90"
                onClick={handleAcknowledge}
              >
                I&apos;ve saved it — done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
