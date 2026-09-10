"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  financialYearSettingsSchema,
  type FinancialYearSettingsInput,
} from "@/lib/settings/schema";
import { saveFinancialYearSettings } from "@/app/(dashboard)/settings/general/actions";

const MONTH_OPTIONS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
] as const;

function monthName(month: number): string {
  return MONTH_OPTIONS.find((option) => option.value === month)?.label ?? "";
}

/**
 * FySettingsForm — react-hook-form + Zod editor for the app_settings
 * financial-year start (FY-01, D-11/D-12/D-13). Mirrors
 * components/pricing/pricing-tier-form.tsx's zodResolver + bannerError
 * shape.
 *
 * Client-side zodResolver validation is UX only; saveFinancialYearSettings
 * re-validates with the same schema server-side — this component never
 * trusts its own validation as the security boundary.
 */
export function FySettingsForm({
  fyStartMonth,
  fyStartDay,
}: {
  fyStartMonth: number;
  fyStartDay: number;
}) {
  const [bannerError, setBannerError] = useState<string | null>(null);

  const form = useForm<FinancialYearSettingsInput>({
    resolver: zodResolver(financialYearSettingsSchema),
    defaultValues: { fyStartMonth, fyStartDay },
  });

  const onSubmit = form.handleSubmit(async (data) => {
    setBannerError(null);
    const result = await saveFinancialYearSettings(data);

    if ("error" in result) {
      const message =
        typeof result.error === "string"
          ? result.error
          : "Enter a valid day for the selected month (e.g. day 30 is invalid for February).";
      setBannerError(message);
      return;
    }

    toast.success(
      `Financial year settings saved. The financial-year boundary now starts ${monthName(data.fyStartMonth)} ${data.fyStartDay}.`,
    );
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fyStartMonth">Financial year start month</Label>
          <Select
            value={String(form.watch("fyStartMonth"))}
            onValueChange={(value) =>
              form.setValue("fyStartMonth", Number(value), {
                shouldValidate: true,
                shouldDirty: true,
              })
            }
          >
            <SelectTrigger id="fyStartMonth" aria-label="Financial year start month">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTH_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={String(option.value)}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fyStartDay">Financial year start day</Label>
          <Input
            id="fyStartDay"
            type="number"
            className="font-mono tabular-nums"
            {...form.register("fyStartDay", { valueAsNumber: true })}
          />
          {form.formState.errors.fyStartDay && (
            <p className="text-xs text-destructive">
              {form.formState.errors.fyStartDay.message}
            </p>
          )}
        </div>
      </div>

      <p className="text-sm font-light text-muted-foreground">
        Changing this moves every financial-year boundary — past and future —
        wherever &quot;Financial year&quot; is selected. This change is
        recorded in the log below.
      </p>

      <Button
        type="submit"
        disabled={form.formState.isSubmitting}
        className="self-start bg-[var(--cypher-blue)] text-white hover:bg-[var(--cypher-blue)]/90"
      >
        Save financial year settings
      </Button>
    </form>
  );
}
