"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  revenueForecastSettingsSchema,
  type RevenueForecastSettingsInput,
} from "@/lib/settings/schema";
import { saveRevenueForecastSettings } from "@/app/(dashboard)/settings/general/actions";

/**
 * RevenueForecastSettingsForm — react-hook-form + Zod editor for the
 * app_settings revenue-forecast honest-degradation threshold (FCST-05,
 * D-15). Mirrors `components/settings/alignment-settings-form.tsx`'s
 * zodResolver + bannerError + always-visible scope-impact notice shape
 * exactly, reduced to a single field, per 07-UI-SPEC.md E5.
 *
 * Client-side zodResolver validation is UX only; saveRevenueForecastSettings
 * re-validates with the same schema server-side -- this component never
 * trusts its own validation as the security boundary.
 */
export function RevenueForecastSettingsForm({
  minCoveredDays,
}: {
  minCoveredDays: number;
}) {
  const [bannerError, setBannerError] = useState<string | null>(null);

  const form = useForm<RevenueForecastSettingsInput>({
    resolver: zodResolver(revenueForecastSettingsSchema),
    defaultValues: { minCoveredDays },
  });

  const onSubmit = form.handleSubmit(async (data) => {
    setBannerError(null);
    const result = await saveRevenueForecastSettings(data);

    if ("error" in result) {
      const message =
        typeof result.error === "string"
          ? result.error
          : "Enter a whole number of 1 or more.";
      setBannerError(message);
      return;
    }

    toast.success("Revenue forecast settings saved.");
    form.reset(data);
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

      {/* Always-visible inline scope-impact notice (never a dialog) --
          mirrors the FY-start/alignment precedent for a change that
          restates when a projection first appears without being a
          deletion (D-15, UI-SPEC E5). Wraps to multiple lines rather
          than truncating. */}
      <p className="text-sm font-light text-muted-foreground">
        Changing this value changes when a projection first appears each
        month or year — past projections already shown are not recomputed
        retroactively.
      </p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="minCoveredDays">
          Minimum covered days before projecting
        </Label>
        <Input
          id="minCoveredDays"
          type="number"
          className="font-mono tabular-nums"
          {...form.register("minCoveredDays", { valueAsNumber: true })}
        />
        <p className="text-xs font-light text-muted-foreground">
          Below this many covered days (after excluding the most recent,
          still-settling day), the projection area shows &quot;not enough
          data&quot; instead of a figure. Default 7.
        </p>
        {form.formState.errors.minCoveredDays && (
          <p className="text-xs text-destructive">
            {form.formState.errors.minCoveredDays.message}
          </p>
        )}
      </div>

      <Button
        type="submit"
        disabled={form.formState.isSubmitting}
        className="self-start bg-[var(--cypher-blue)] text-white hover:bg-[var(--cypher-blue)]/90"
      >
        Save revenue forecast settings
      </Button>
    </form>
  );
}
