import { getDaysInMonth } from "date-fns";
import { z } from "zod";

// Single source of truth for financial-year-start AND dual-source-alignment
// settings validation, imported by BOTH the relevant client form
// (components/settings/fy-settings-form.tsx /
// components/settings/alignment-settings-form.tsx) and the server action
// (app/(dashboard)/settings/general/actions.ts) -- per Next.js Server
// Actions guidance, client-side validation is UX-only and the server must
// always re-validate untrusted input against this same schema.
//
// Mirrors lib/pricing/schema.ts's superRefine cross-field shape (05-RESEARCH
// Pitfall 3): the day-in-month check runs against the NON-LEAP reference
// year 2001, so an FY start of 29 February is rejected outright rather than
// silently working in leap years and breaking in every other year.

const REFERENCE_NON_LEAP_YEAR = 2001;

const VALIDATION_MESSAGE =
  "Enter a valid day for the selected month (e.g. day 30 is invalid for February).";

export const financialYearSettingsSchema = z
  .object({
    fyStartMonth: z.number().int().min(1).max(12),
    fyStartDay: z.number().int().min(1).max(31),
  })
  .superRefine((data, ctx) => {
    const daysInMonth = getDaysInMonth(
      new Date(REFERENCE_NON_LEAP_YEAR, data.fyStartMonth - 1, 1),
    );

    if (data.fyStartDay > daysInMonth) {
      ctx.addIssue({
        code: "custom",
        message: VALIDATION_MESSAGE,
        path: ["fyStartDay"],
      });
    }
  });

export type FinancialYearSettingsInput = z.infer<
  typeof financialYearSettingsSchema
>;

// ---------------------------------------------------------------------------
// Dual-source alignment settings (Phase 6 Plan 2, D-09/D-15/D-16)
// ---------------------------------------------------------------------------
// No cross-field superRefine here -- unlike the FY-start pair above, these
// two fields have no day-in-month equivalent; each is independently
// validated as a non-negative whole number. Every rejection (missing,
// non-integer, or negative) surfaces the exact same Copywriting Contract
// message so the form never needs to branch on error type.

const ALIGNMENT_VALIDATION_MESSAGE = "Enter a whole number of zero or more.";

export const alignmentSettingsSchema = z.object({
  baselineOffset: z
    .number({ error: ALIGNMENT_VALIDATION_MESSAGE })
    .int({ message: ALIGNMENT_VALIDATION_MESSAGE })
    .min(0, { message: ALIGNMENT_VALIDATION_MESSAGE }),
  toleranceCount: z
    .number({ error: ALIGNMENT_VALIDATION_MESSAGE })
    .int({ message: ALIGNMENT_VALIDATION_MESSAGE })
    .min(0, { message: ALIGNMENT_VALIDATION_MESSAGE }),
});

export type AlignmentSettingsInput = z.infer<typeof alignmentSettingsSchema>;

// ---------------------------------------------------------------------------
// Revenue forecast honest-degradation threshold (Phase 7 Plan 2, D-15/FCST-05)
// ---------------------------------------------------------------------------
// A single positive-integer field: the minimum number of USABLE covered days
// (after the D-02 drop of the most recent day) required before /revenue
// shows a projection. Floor is 1, not 0 (unlike alignmentSettingsSchema's
// fields) -- a projection from zero usable days is not a projection. Every
// rejection carries the identical message string (07-UI-SPEC.md Copywriting
// Contract), so the form never branches on error type.

const REVENUE_FORECAST_VALIDATION_MESSAGE = "Enter a whole number of 1 or more.";

export const revenueForecastSettingsSchema = z.object({
  minCoveredDays: z
    .number({ error: REVENUE_FORECAST_VALIDATION_MESSAGE })
    .int({ message: REVENUE_FORECAST_VALIDATION_MESSAGE })
    .min(1, { message: REVENUE_FORECAST_VALIDATION_MESSAGE }),
});

export type RevenueForecastSettingsInput = z.infer<
  typeof revenueForecastSettingsSchema
>;

// ---------------------------------------------------------------------------
// Report source freshness settings (Phase 10 Plan 4, FRESH-05/D-13)
// ---------------------------------------------------------------------------
// The single source of truth imported by BOTH the per-row client form
// (components/settings/source-settings-form.tsx) and the per-row Server
// Action (app/(dashboard)/settings/sources/actions.ts) -- exactly the same
// "client validation is UX only, the server re-validates" discipline as
// every other schema in this file. `reportType` is a closed enum of the six
// migration-seeded `report_sources` rows (mirrors `SOURCE_ORDER` in
// lib/dashboard/freshness.ts) so a forged seventh source can never be
// addressed by this action. The floor on `staleAfterHours` is 1, not 0
// (unlike `alignmentSettingsSchema`'s fields): a zero-hour threshold marks a
// source overdue from the instant its own covered day ends, which is never
// a meaningful operator intent. Every rejection on `staleAfterHours` carries
// the identical Copywriting Contract message so the form never branches on
// error type.

const REPORT_SOURCE_STALE_HOURS_MESSAGE =
  "Enter a whole number of hours greater than 0.";

export const reportSourceSettingsSchema = z.object({
  reportType: z.enum([
    "verification",
    "billing",
    "dcvv",
    "card-inventory",
    "removed-cards",
    "apigee-stats",
  ]),
  expectedCadence: z.enum(["daily-business", "daily", "none"]),
  staleAfterHours: z
    .number({ error: REPORT_SOURCE_STALE_HOURS_MESSAGE })
    .int({ message: REPORT_SOURCE_STALE_HOURS_MESSAGE })
    .min(1, { message: REPORT_SOURCE_STALE_HOURS_MESSAGE }),
  enabled: z.boolean(),
});

export type ReportSourceSettingsInput = z.infer<
  typeof reportSourceSettingsSchema
>;

// ---------------------------------------------------------------------------
// Drain cron run time (Phase 10 Plan 5, FRESH-05/D-14)
// ---------------------------------------------------------------------------
// A regex on the HH:mm string, rather than a coerced Date, is what keeps the
// value the same five characters all the way from `<Input type="time">` to
// the `time` column and on into fn_set_drain_cron_schedule's cron
// expression -- no timezone conversion happens anywhere on this path, and a
// coercion through Date would silently introduce one.

export const drainRunTimeSchema = z.object({
  runTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
      message: "Enter a time as HH:mm, 24-hour.",
    }),
});

export type DrainRunTimeInput = z.infer<typeof drainRunTimeSchema>;
