"use client";

import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  pricingTierSetSchema,
  type PricingTierSetInput,
} from "@/lib/pricing/schema";
import { savePricingTierSet } from "@/app/(dashboard)/settings/pricing/actions";

const RESET_WINDOW_OPTIONS = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "none", label: "None (cumulative)" },
] as const;

const EMPTY_TIER = { upperBound: null, rate: 0 } as const;

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * PricingTierForm — the dynamic react-hook-form + Zod tier editor (D-05).
 *
 * Client-side zodResolver validation is UX only; savePricingTierSet
 * re-validates with the same schema server-side (T-03-05) — this component
 * never trusts its own validation as the security boundary.
 */
export function PricingTierForm() {
  const [bannerError, setBannerError] = useState<string | null>(null);

  const form = useForm<PricingTierSetInput>({
    resolver: zodResolver(pricingTierSetSchema),
    defaultValues: {
      effectiveFrom: todayIsoDate(),
      resetWindow: "monthly",
      tiers: [
        { upperBound: 500000, rate: 0.08 },
        { upperBound: null, rate: 0.09 },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "tiers",
  });

  const tiersFieldError = form.formState.errors.tiers;
  const tiersError =
    tiersFieldError && "root" in tiersFieldError
      ? tiersFieldError.root?.message
      : (tiersFieldError as { message?: string } | undefined)?.message;

  const onSubmit = form.handleSubmit(async (data) => {
    setBannerError(null);
    const result = await savePricingTierSet(data);

    if ("error" in result) {
      const message =
        typeof result.error === "string"
          ? result.error
          : "Tiers must be contiguous and in ascending order — check the thresholds and try again.";
      setBannerError(message);
      return;
    }

    toast.success(
      `Pricing tiers saved. Revenue for ${data.effectiveFrom} onward will use the new rates.`
    );
    form.reset({
      effectiveFrom: data.effectiveFrom,
      resetWindow: data.resetWindow,
      tiers: data.tiers,
    });
  });

  return (
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
                    className={cn("font-mono tabular-nums")}
                    {...form.register(`tiers.${index}.upperBound`, {
                      setValueAs: (value) =>
                        value === "" || value === null ? null : Number(value),
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
  );
}
