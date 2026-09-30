"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { drainRunTimeSchema } from "@/lib/settings/schema";
import { saveDrainRunTime } from "@/app/(dashboard)/settings/sources/actions";

const RUN_TIME_FALLBACK_ERROR = "Enter a time as HH:mm, 24-hour.";

/**
 * DrainRunTimeForm — the editable branch of `/settings/sources`' "Daily
 * check run time" section (FRESH-05, D-14), rendered only when
 * `DRAIN_SCHEDULE_EDITABLE` is `true` (plan 10-02's measured D-15 verdict).
 * The degraded read-only branch is a static box in `page.tsx`, not this
 * component.
 *
 * Client-side Zod validation (`drainRunTimeSchema`) is UX only —
 * `saveDrainRunTime` re-validates the same schema server-side, and this
 * component never trusts its own validation as the security boundary.
 *
 * `useTransition` pending handling mirrors `SourceSettingsRow`
 * (`source-settings-form.tsx`): the Save button disables while pending and
 * shows "Saving…"; on failure the entered value is left in the field for
 * retry rather than reset, matching the retry-without-re-entry discipline
 * used across this codebase's settings forms.
 */
export function DrainRunTimeForm({ runTime }: { runTime: string }) {
  const [value, setValue] = useState(runTime);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    const parsed = drainRunTimeSchema.safeParse({ runTime: value });

    if (!parsed.success) {
      const message =
        parsed.error.issues[0]?.message ?? RUN_TIME_FALLBACK_ERROR;
      toast.error(message);
      return;
    }

    startTransition(async () => {
      const result = await saveDrainRunTime(parsed.data);

      if ("error" in result) {
        // Leave the entered value exactly as typed -- never reset it on
        // failure, so the change can be retried without re-entering it.
        toast.error(result.error);
        return;
      }

      toast.success("Daily check run time saved.");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Label htmlFor="drain-run-time">Daily check run time</Label>
      <p className="text-sm text-muted-foreground">
        Every source is checked once a day, right after the drain finishes.
        Times are UTC.
      </p>
      <div className="flex items-center gap-3">
        <Input
          id="drain-run-time"
          type="time"
          className="font-mono tabular-nums w-auto"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label="Daily check run time"
        />
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={handleSave}
        >
          {isPending ? "Saving…" : "Save run time"}
        </Button>
      </div>
    </div>
  );
}
