"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SOURCE_ORDER, type ReportSourceRow } from "@/lib/dashboard/freshness";
import {
  reportSourceSettingsSchema,
  type ReportSourceSettingsInput,
} from "@/lib/settings/schema";
import { saveReportSourceSettings } from "@/app/(dashboard)/settings/sources/actions";

type Cadence = ReportSourceSettingsInput["expectedCadence"];

type Draft = {
  expectedCadence: Cadence;
  staleAfterHours: number;
  enabled: boolean;
};

const CADENCE_OPTIONS: readonly { value: Cadence; label: string }[] = [
  { value: "daily-business", label: "Business days only" },
  { value: "daily", label: "Every day" },
  { value: "none", label: "No fixed cadence" },
] as const;

const STALE_HOURS_FALLBACK_MESSAGE =
  "Enter a whole number of hours greater than 0.";
const SAVE_ERROR_FALLBACK_MESSAGE = "please check the values and try again";

function draftFromRow(row: ReportSourceRow): Draft {
  return {
    expectedCadence: row.expected_cadence,
    staleAfterHours: row.stale_after_hours,
    enabled: row.enabled,
  };
}

function draftsRecord(rows: ReportSourceRow[]): Record<string, Draft> {
  const record: Record<string, Draft> = {};
  for (const row of rows) {
    record[row.report_type] = draftFromRow(row);
  }
  return record;
}

function isDirty(draft: Draft, baseline: Draft): boolean {
  return (
    draft.expectedCadence !== baseline.expectedCadence ||
    draft.staleAfterHours !== baseline.staleAfterHours ||
    draft.enabled !== baseline.enabled
  );
}

/**
 * SourceSettingsForm — the /settings/sources per-row table editor
 * (FRESH-05, D-13). No exact analog exists elsewhere in this codebase for a
 * fixed multi-row table edited in place with per-row save; built from
 * UI-SPEC Screen Contract §4 section 2 plus fy-settings-form.tsx's
 * validation/toast conventions and mint-credential-form.tsx's
 * retry-without-re-entry failure handling.
 *
 * Client-side Zod validation (`reportSourceSettingsSchema`) is UX only —
 * `saveReportSourceSettings` re-validates the SAME schema server-side, and
 * this component never trusts its own validation as the security boundary.
 *
 * Drafts for all six rows live in ONE `useState` record keyed by
 * `reportType` at this level; each row still owns its OWN `useTransition`
 * (inside `SourceSettingsRow` below), so one row's in-flight save, or an
 * invalid edit to a different row, can never block or disable this row's
 * save. Never a whole-table submit — each row calls
 * `saveReportSourceSettings` independently with only its own payload.
 */
export function SourceSettingsForm({ rows }: { rows: ReportSourceRow[] }) {
  const rowByType = new Map(rows.map((row) => [row.report_type, row]));

  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    draftsRecord(rows),
  );
  const [baselines, setBaselines] = useState<Record<string, Draft>>(() =>
    draftsRecord(rows),
  );

  function updateDraft(reportType: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({
      ...prev,
      [reportType]: { ...prev[reportType], ...patch },
    }));
  }

  function rebaseBaseline(reportType: string, saved: Draft) {
    setBaselines((prev) => ({ ...prev, [reportType]: saved }));
  }

  return (
    <div className="flex flex-col gap-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Source</TableHead>
            <TableHead>Cadence</TableHead>
            <TableHead>Overdue after</TableHead>
            <TableHead>Enabled</TableHead>
            <TableHead>
              <span className="sr-only">Save</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {SOURCE_ORDER.map(({ reportType, label }) => {
            const row = rowByType.get(reportType);
            const draft = drafts[reportType];
            const baseline = baselines[reportType];
            // report_sources is migration-seeded with all six rows -- this
            // should never happen, but a source absent from the read still
            // renders nothing rather than throwing.
            if (!row || !draft || !baseline) return null;

            return (
              <SourceSettingsRow
                key={reportType}
                reportType={reportType}
                label={label}
                draft={draft}
                baseline={baseline}
                onChange={(patch) => updateDraft(reportType, patch)}
                onSaved={(saved) => rebaseBaseline(reportType, saved)}
              />
            );
          })}
        </TableBody>
      </Table>

      <p className="text-xs font-light text-muted-foreground">
        &quot;Business days only&quot; skips weekends when checking overdue
        status — a Saturday with no file is never flagged.
      </p>
    </div>
  );
}

function SourceSettingsRow({
  reportType,
  label,
  draft,
  baseline,
  onChange,
  onSaved,
}: {
  reportType: string;
  label: string;
  draft: Draft;
  baseline: Draft;
  onChange: (patch: Partial<Draft>) => void;
  onSaved: (saved: Draft) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const dirty = isDirty(draft, baseline);

  function handleSave() {
    const parsed = reportSourceSettingsSchema.safeParse({
      reportType,
      expectedCadence: draft.expectedCadence,
      staleAfterHours: draft.staleAfterHours,
      enabled: draft.enabled,
    });

    if (!parsed.success) {
      const message =
        parsed.error.issues[0]?.message ?? STALE_HOURS_FALLBACK_MESSAGE;
      toast.error(`Could not save ${label} settings — ${message}.`);
      return;
    }

    startTransition(async () => {
      const result = await saveReportSourceSettings(parsed.data);

      if ("error" in result) {
        const message =
          typeof result.error === "string"
            ? result.error
            : SAVE_ERROR_FALLBACK_MESSAGE;
        // Leave the row's draft exactly as typed -- never reset it on
        // failure, so the change can be retried without re-entering it.
        toast.error(`Could not save ${label} settings — ${message}.`);
        return;
      }

      toast.success(`Saved ${label} settings.`);
      onSaved(draft);
    });
  }

  return (
    <TableRow>
      <TableCell>{label}</TableCell>
      <TableCell>
        <Select
          value={draft.expectedCadence}
          onValueChange={(value) =>
            onChange({ expectedCadence: value as Cadence })
          }
        >
          <SelectTrigger aria-label={`${label} cadence`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CADENCE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            step={1}
            className="font-mono tabular-nums"
            value={draft.staleAfterHours}
            onChange={(event) =>
              onChange({ staleAfterHours: Number(event.target.value) })
            }
            aria-label={`${label} overdue-after threshold, in hours`}
          />
          <span className="text-sm font-light text-muted-foreground">
            hours
          </span>
        </div>
      </TableCell>
      <TableCell>
        <Switch
          checked={draft.enabled}
          onCheckedChange={(checked) => onChange({ enabled: checked })}
          aria-label={`${label} monitoring enabled`}
        />
      </TableCell>
      <TableCell>
        {dirty && (
          <Button
            type="button"
            size="sm"
            disabled={isPending}
            aria-label={`Save ${label} settings`}
            onClick={handleSave}
          >
            Save
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}
