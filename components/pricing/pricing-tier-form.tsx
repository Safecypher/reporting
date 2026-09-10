"use client";

import { useEffect, useState, useTransition } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  pricingTierSetSchema,
  type PricingTierSetInput,
} from "@/lib/pricing/schema";
import {
  countRestatedDays,
  savePricingTierSet,
} from "@/app/(dashboard)/settings/pricing/actions";
import {
  NEW_TIER_SET_VALUE,
  TierSetSelector,
  type TierSetSelectorOption,
} from "@/components/pricing/tier-set-selector";
import { DeleteTierSet } from "@/components/pricing/delete-tier-set";
import {
  resolveSaveImpact,
  type TierSetSaveMode,
} from "@/lib/pricing/restate-scope";

const RESET_WINDOW_OPTIONS = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "none", label: "None (cumulative)" },
] as const;

const EMPTY_TIER = { upperBound: null, rate: 0 } as const;

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultFormValues(): PricingTierSetInput {
  return {
    effectiveFrom: todayIsoDate(),
    resetWindow: "monthly",
    tiers: [
      { upperBound: 500000, rate: 0.08 },
      { upperBound: null, rate: 0.09 },
    ],
  };
}

export interface PricingTierSetWithTiers extends TierSetSelectorOption {
  resetWindow: string;
  tiers: { upperBound: number | null; rate: number }[];
}

/**
 * "edit" — the existing D-18/P-04 restate dialog (unchanged copy/behaviour).
 * "create-supersede" — G-05-5: a NEW tier set landing on a date an existing
 * set already prices. `supersedes`/`proposedEffectiveFrom` are only
 * populated for that variant.
 */
type RestateDialogVariant = "edit" | "create-supersede";

interface RestateDialogState {
  open: boolean;
  variant: RestateDialogVariant;
  days: number;
  pendingData: PricingTierSetInput | null;
  supersedes: string | null;
  proposedEffectiveFrom: string | null;
}

const CLOSED_RESTATE_DIALOG: RestateDialogState = {
  open: false,
  variant: "edit",
  days: 0,
  pendingData: null,
  supersedes: null,
  proposedEffectiveFrom: null,
};

interface PricingTierFormProps {
  tierSets: PricingTierSetWithTiers[];
}

/**
 * PricingTierForm — the dynamic react-hook-form + Zod tier editor (D-05),
 * now also the D-17 in-place editor: a `TierSetSelector` above the fields
 * lets the user choose `New tier set` (insert, the default) or an existing
 * set (in-place edit, loading its current values). D-18: submitting a
 * change to an existing set first counts the affected already-elapsed days
 * via `countRestatedDays` — zero affected days saves immediately, one or
 * more opens a warning-styled confirmation dialog before the write happens.
 *
 * G-05-5 (05-07): BOTH the edit path above and the create (new-set) path
 * now go through `resolveSaveImpact` (`lib/pricing/restate-scope.ts`) on
 * submit. A create that lands on a date an existing set already prices
 * ALWAYS opens a confirmation naming the superseded set — regardless of
 * whether any affected day carries activity, which is what let the live
 * incident happen silently (see restate-scope.ts's module header). A
 * create for a date nothing prices yet still saves in one click.
 *
 * Client-side zodResolver validation is UX only; savePricingTierSet
 * re-validates with the same schema server-side (T-03-05) — this component
 * never trusts its own validation as the security boundary.
 */
export function PricingTierForm({ tierSets }: PricingTierFormProps) {
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [selectedTierSetId, setSelectedTierSetId] = useState<string>(NEW_TIER_SET_VALUE);
  const [restateDialog, setRestateDialog] = useState<RestateDialogState>(CLOSED_RESTATE_DIALOG);
  const [isRestateSavePending, startRestateSaveTransition] = useTransition();

  const form = useForm<PricingTierSetInput>({
    resolver: zodResolver(pricingTierSetSchema),
    defaultValues: defaultFormValues(),
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "tiers",
  });

  // CR-01: the UI must not allow submitting a bounded top tier — the last
  // tier's upperBound is always forced to null (open-ended), regardless of
  // add/remove/reorder/tier-set-selection, so the Zod "last tier must be
  // open-ended" rule can never actually be triggered by a normal user
  // interaction; it only remains as defense-in-depth for a direct/malformed
  // submission.
  const lastIndex = fields.length - 1;
  useEffect(() => {
    if (lastIndex >= 0) {
      form.setValue(`tiers.${lastIndex}.upperBound`, null, {
        shouldValidate: false,
        shouldDirty: false,
      });
    }
    // Only re-run when the set of tiers (and therefore which index is last)
    // changes — not on every keystroke of an unrelated field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields.length]);

  // Derived from the live `tierSets` prop (never a separately-cached copy)
  // so a successful edit/delete elsewhere (revalidatePath refetches this
  // Server Component subtree) keeps this in sync automatically — including
  // the delete-control-disappears-when-its-own-set-is-gone case.
  const selectedTierSet = tierSets.find((tierSet) => tierSet.id === selectedTierSetId) ?? null;

  const tiersFieldError = form.formState.errors.tiers;
  const tiersError =
    tiersFieldError && "root" in tiersFieldError
      ? tiersFieldError.root?.message
      : (tiersFieldError as { message?: string } | undefined)?.message;

  function handleTierSetChange(value: string) {
    setSelectedTierSetId(value);
    setBannerError(null);

    if (value === NEW_TIER_SET_VALUE) {
      form.reset(defaultFormValues());
      return;
    }

    const tierSet = tierSets.find((set) => set.id === value);
    if (!tierSet) return;

    form.reset({
      effectiveFrom: tierSet.effectiveFrom,
      resetWindow: tierSet.resetWindow as PricingTierSetInput["resetWindow"],
      tiers: tierSet.tiers,
    });
  }

  /** Performs the actual write and shared success/error handling — shared
   * by the no-dialog-needed path and the restate-dialog confirm path. */
  async function performSave(
    data: PricingTierSetInput,
    tierSetId: string | null,
  ): Promise<boolean> {
    const result = await savePricingTierSet(data, tierSetId);

    if ("error" in result) {
      const message =
        typeof result.error === "string"
          ? result.error
          : "Tiers must be contiguous and in ascending order — check the thresholds and try again.";
      setBannerError(message);
      return false;
    }

    toast.success(
      `Pricing tiers saved. Revenue for ${data.effectiveFrom} onward will use the new rates.`,
    );
    form.reset({
      effectiveFrom: data.effectiveFrom,
      resetWindow: data.resetWindow,
      tiers: data.tiers,
    });
    return true;
  }

  const onSubmit = form.handleSubmit(async (data) => {
    setBannerError(null);

    const tierSetIdForSave = selectedTierSet ? selectedTierSet.id : null;

    // G-05-5: BOTH the create and edit paths go through the same resolver
    // now. Mode is derived from `selectedTierSet` — create when nothing is
    // selected, edit carrying the selected set's id/effectiveFrom
    // otherwise. The edited set is excluded from the existing-sets list so
    // an edit never reports itself as superseding itself (belt-and-braces:
    // resolveSaveImpact's edit branch ignores the list entirely, but the
    // exclusion keeps the call site honest about scope).
    const mode: TierSetSaveMode = selectedTierSet
      ? { kind: "edit", id: selectedTierSet.id, effectiveFrom: selectedTierSet.effectiveFrom }
      : { kind: "create" };
    const existingForImpact = selectedTierSet
      ? tierSets.filter((set) => set.id !== selectedTierSet.id)
      : tierSets;
    const impact = resolveSaveImpact(mode, data.effectiveFrom, existingForImpact);

    if (impact === null) {
      // create-only: nothing active prices this date yet — the genuinely-
      // first-set case stays frictionless (P-04's exemption, now correctly
      // scoped). Edit mode never returns null.
      await performSave(data, tierSetIdForSave);
      return;
    }

    const countResult = await countRestatedDays(impact.from, impact.through);

    if ("error" in countResult) {
      setBannerError(
        "Could not determine how many days this change would affect — please try again.",
      );
      return;
    }

    if (mode.kind === "edit") {
      // D-18/P-04 verbatim: zero affected days saves immediately, one or
      // more opens the (unchanged) restate dialog.
      if (countResult.days === 0) {
        await performSave(data, tierSetIdForSave);
        return;
      }
      setRestateDialog({
        ...CLOSED_RESTATE_DIALOG,
        open: true,
        variant: "edit",
        days: countResult.days,
        pendingData: data,
      });
      return;
    }

    // create: an existing set already prices this date — ALWAYS open the
    // confirmation, regardless of day count. This is the gate the live
    // incident needed and it must not be conditioned on activity days
    // (see the module header of lib/pricing/restate-scope.ts).
    setRestateDialog({
      open: true,
      variant: "create-supersede",
      days: countResult.days,
      pendingData: data,
      // Non-null by construction: the create branch of resolveSaveImpact
      // only returns a non-null impact when it found a superseded set.
      supersedes: impact.supersedes as string,
      proposedEffectiveFrom: impact.from,
    });
  });

  function handleRestateCancel() {
    // "Keep editing" — returns to the still-populated form without
    // discarding the edit; the form data itself is untouched.
    setRestateDialog(CLOSED_RESTATE_DIALOG);
  }

  function handleRestateConfirm() {
    if (!restateDialog.pendingData) return;
    const pendingData = restateDialog.pendingData;
    const tierSetId = selectedTierSet ? selectedTierSet.id : null;

    startRestateSaveTransition(async () => {
      // A server-rejected save closes the dialog and surfaces the failure
      // in the form's existing error banner — never a silent close.
      await performSave(pendingData, tierSetId);
      setRestateDialog(CLOSED_RESTATE_DIALOG);
    });
  }

  // Copy for the two restate-dialog variants (D-18 edit, unchanged; G-05-5
  // create-supersede, new). Kept out of the JSX below so both bodies stay
  // easy to diff against 05-UI-SPEC.md's Copywriting Contract verbatim.
  const restateDialogCopy =
    restateDialog.variant === "create-supersede"
      ? {
          title: "Add a new tier set and supersede the current rates?",
          body:
            restateDialog.days > 0
              ? `This creates a new tier set effective ${restateDialog.proposedEffectiveFrom}. From that date it replaces the tier set effective ${restateDialog.supersedes}, including ${restateDialog.days} ${restateDialog.days === 1 ? "day" : "days"} already recorded, whose revenue will be restated. This is recorded in the change history.`
              : `This creates a new tier set effective ${restateDialog.proposedEffectiveFrom}. From that date it replaces the tier set effective ${restateDialog.supersedes} for all revenue. No day recorded so far changes. This is recorded in the change history.`,
          confirmLabel:
            restateDialog.days > 0 ? "Add tier set and restate revenue" : "Add tier set",
        }
      : {
          title: "Save changes to pricing tiers?",
          body: `This will restate revenue for ${restateDialog.days} ${restateDialog.days === 1 ? "day" : "days"}. Past figures shown for that period will change to reflect the corrected rates. This is recorded in the change history.`,
          confirmLabel: "Save and restate revenue",
        };

  return (
    <div className="flex flex-col gap-6">
      <TierSetSelector
        value={selectedTierSetId}
        onValueChange={handleTierSetChange}
        tierSets={tierSets}
      />

      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-6 rounded-lg border border-border p-6"
      >
        {bannerError && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {bannerError}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="effectiveFrom">Effective from</Label>
            <Input
              id="effectiveFrom"
              type="date"
              {...form.register("effectiveFrom")}
            />
            {form.formState.errors.effectiveFrom && (
              <p className="text-xs text-destructive">
                {form.formState.errors.effectiveFrom.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="resetWindow">Reset window</Label>
            <select
              id="resetWindow"
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              {...form.register("resetWindow")}
            >
              {RESET_WINDOW_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-foreground">Tiers</p>

          {tiersError && (
            <p role="alert" className="text-xs text-destructive">
              {tiersError}
            </p>
          )}

          <div className="flex flex-col gap-3">
            {fields.map((field, index) => {
              const isLast = index === fields.length - 1;

              return (
                <div
                  key={field.id}
                  className="grid grid-cols-[auto_1fr_1fr_auto] items-end gap-3"
                >
                  <span className="pb-1.5 text-sm font-medium text-foreground">
                    Tier {index + 1}
                  </span>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`tiers.${index}.upperBound`}>
                      Upper bound
                    </Label>
                    <Input
                      id={`tiers.${index}.upperBound`}
                      type="number"
                      placeholder={isLast ? "Open-ended" : undefined}
                      disabled={isLast}
                      aria-disabled={isLast}
                      // CR-01: the last tier's upper bound is always null
                      // (open-ended) — disabled here so the UI cannot submit a
                      // bounded top tier; value is force-set via the useEffect
                      // above whenever the tier set changes.
                      className={cn(
                        "font-mono tabular-nums",
                        isLast && "cursor-not-allowed opacity-60",
                      )}
                      {...form.register(`tiers.${index}.upperBound`, {
                        setValueAs: (value) =>
                          isLast || value === "" || value === null ? null : Number(value),
                      })}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`tiers.${index}.rate`}>Rate</Label>
                    <Input
                      id={`tiers.${index}.rate`}
                      type="number"
                      step="0.0001"
                      className="font-mono tabular-nums"
                      {...form.register(`tiers.${index}.rate`, {
                        valueAsNumber: true,
                      })}
                    />
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => remove(index)}
                  >
                    Remove
                  </Button>
                </div>
              );
            })}
          </div>

          <Button
            type="button"
            variant="secondary"
            className="self-start"
            onClick={() => append({ ...EMPTY_TIER })}
          >
            Add tier
          </Button>
        </div>

        <Button
          type="submit"
          disabled={form.formState.isSubmitting}
          className="self-start bg-[var(--cypher-blue)] text-white hover:bg-[var(--cypher-blue)]/90"
        >
          Save pricing tiers
        </Button>
      </form>

      {selectedTierSet && (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-6">
          <p className="text-sm font-medium text-foreground">
            Correct a mistake
          </p>
          <p className="max-w-2xl text-sm font-light text-muted-foreground">
            Need to remove this tier set entirely instead of editing it? You
            can delete the tier set effective {selectedTierSet.effectiveFrom}.
          </p>
          <DeleteTierSet
            tierSetId={selectedTierSet.id}
            effectiveFrom={selectedTierSet.effectiveFrom}
          />
        </div>
      )}

      {/* D-18: warning-styled restate confirmation — a legitimate save, so
          the confirm button stays Cypher Blue (--primary), never
          --destructive; only the icon/border use --warning tokens. */}
      <Dialog
        open={restateDialog.open}
        onOpenChange={(open) => {
          if (!open) handleRestateCancel();
        }}
      >
        <DialogContent className="border-[var(--warning-border)]">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <svg
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0 text-[var(--warning)]"
              >
                <use href="/icons.svg#alert" />
              </svg>
              <div className="flex flex-col gap-2 text-left">
                <DialogTitle>{restateDialogCopy.title}</DialogTitle>
                <DialogDescription>{restateDialogCopy.body}</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isRestateSavePending}
              onClick={handleRestateCancel}
            >
              Keep editing
            </Button>
            <Button
              type="button"
              disabled={isRestateSavePending}
              onClick={handleRestateConfirm}
              className="bg-[var(--cypher-blue)] text-white hover:bg-[var(--cypher-blue)]/90"
            >
              {isRestateSavePending ? "Saving…" : restateDialogCopy.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
