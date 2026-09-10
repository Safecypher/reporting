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
import { deletePricingTierSet } from "@/app/(dashboard)/settings/pricing/actions";

interface DeleteTierSetProps {
  tierSetId: string;
  effectiveFrom: string;
}

/**
 * DeleteTierSet — the generalised correction control (D-19, replaces
 * `DeleteLatestTierSet`): lets a user remove WHICHEVER tier set is currently
 * selected in `TierSetSelector`, behind a confirmation `Dialog` (never
 * one-click). The real guard — at least one tier set must keep covering the
 * data window (from 2026-08-13) — lives in `delete_pricing_tier_set`
 * (supabase/migrations/0025), not here; this UI is the two-step
 * confirmation surface plus the explicit refusal toast when the server
 * blocks the delete (UI-SPEC E8 error: never a silent no-op).
 */
export function DeleteTierSet({ tierSetId, effectiveFrom }: DeleteTierSetProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await deletePricingTierSet(tierSetId);

      if ("error" in result) {
        toast.error(result.error);
        return;
      }

      toast.success(`Deleted the pricing tier set effective ${effectiveFrom}.`);
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="destructive">
          Delete this tier set
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this pricing tier set?</DialogTitle>
          <DialogDescription>
            This removes the tier set effective {effectiveFrom}. The
            deletion is recorded in the change history below. This cannot be
            undone.
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
            {isPending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
