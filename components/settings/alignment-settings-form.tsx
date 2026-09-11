"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  alignmentSettingsSchema,
  type AlignmentSettingsInput,
} from "@/lib/settings/schema";
import { saveAlignmentSettings } from "@/app/(dashboard)/settings/general/actions";

/**
 * AlignmentSettingsForm — react-hook-form + Zod editor for the app_settings
 * TSYS live-cards baseline offset and alignment tolerance (ALIGN-06,
 * D-09/D-15/D-16). Mirrors `components/settings/fy-settings-form.tsx`'s
 * zodResolver + bannerError + always-visible scope-impact notice shape
 * exactly, per UI-SPEC E7.
 *
 * Client-side zodResolver validation is UX only; saveAlignmentSettings
 * re-validates with the same schema server-side -- this component never
 * trusts its own validation as the security boundary.
 */
export function AlignmentSettingsForm({
  baselineOffset,
  toleranceCount,
}: {
  baselineOffset: number;
  toleranceCount: number;
}) {
  const [bannerError, setBannerError] = useState<string | null>(null);

  const form = useForm<AlignmentSettingsInput>({
    resolver: zodResolver(alignmentSettingsSchema),
    defaultValues: { baselineOffset, toleranceCount },
  });

  const onSubmit = form.handleSubmit(async (data) => {
    setBannerError(null);
    const result = await saveAlignmentSettings(data);

    if ("error" in result) {
      const message =
        typeof result.error === "string"
          ? result.error
          : "Enter a whole number of zero or more.";
      setBannerError(message);
      return;
    }

    toast.success("Alignment settings saved.");
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
          mirrors the FY-start precedent for a change that restates past
          verdicts without being a deletion (D-09/D-15, UI-SPEC E7). Wraps
          to multiple lines rather than truncating. */}
      <p className="text-sm font-light text-muted-foreground">
        Changing these values changes which days show as aligned, needs
        review, or mismatch on the Alignment page — past and future. This
        change is recorded in the log below.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="baselineOffset">
            TSYS live-cards baseline offset
          </Label>
          <Input
            id="baselineOffset"
            type="number"
            className="font-mono tabular-nums"
            {...form.register("baselineOffset", { valueAsNumber: true })}
          />
          <p className="text-xs font-light text-muted-foreground">
            The number of cards already live before 13 Aug 2026 — explains
            the permanent gap between the TSYS and Bit Addict live-card
            counts. Recorded with today&apos;s date as its &quot;as of&quot;
            basis.
          </p>
          {form.formState.errors.baselineOffset && (
            <p className="text-xs text-destructive">
              {form.formState.errors.baselineOffset.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="toleranceCount">Alignment tolerance</Label>
          <Input
            id="toleranceCount"
            type="number"
            className="font-mono tabular-nums"
            {...form.register("toleranceCount", { valueAsNumber: true })}
          />
          <p className="text-xs font-light text-muted-foreground">
            The number of records TSYS and Bit Addict may differ by and
            still count as aligned. Applies to every metric on the
            Alignment page. Default 0.
          </p>
          {form.formState.errors.toleranceCount && (
            <p className="text-xs text-destructive">
              {form.formState.errors.toleranceCount.message}
            </p>
          )}
        </div>
      </div>

      <Button
        type="submit"
        disabled={form.formState.isSubmitting}
        className="self-start bg-[var(--cypher-blue)] text-white hover:bg-[var(--cypher-blue)]/90"
      >
        Save alignment settings
      </Button>
    </form>
  );
}
