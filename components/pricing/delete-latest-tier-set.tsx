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
import { deleteLatestPricingTierSet } from "@/app/(dashboard)/settings/pricing/actions";

interface DeleteLatestTierSetProps {
  tierSetId: string;
  effectiveFrom: string;
}

/**
 * DeleteLatestTierSet — the UAT correction control (UAT-DELETE-01): lets a
 * user undo an accidental save by removing ONLY the most recent pricing
 * tier set, behind a confirmation Dialog (never one-click). The real
 * guard — "only the latest set can be deleted" — lives in the
 * delete_latest_pricing_tier_set RPC (0016), not here; this UI is just the
 * two-step confirmation surface.
 */
export function DeleteLatestTierSet({
  tierSetId,
  effectiveFrom,
}: DeleteLatestTierSetProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await deleteLatestPricingTierSet(tierSetId);

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
          Delete latest pricing tier set
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete latest pricing tier set?</DialogTitle>
          <DialogDescription>
            This removes the pricing tier set effective {effectiveFrom}. The
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
