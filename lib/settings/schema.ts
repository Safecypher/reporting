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
