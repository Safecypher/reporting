import { getDaysInMonth } from "date-fns";
import { z } from "zod";

// Single source of truth for financial-year-start validation, imported by
// BOTH the client form (components/settings/fy-settings-form.tsx) and the
// server action (app/(dashboard)/settings/general/actions.ts) -- per
// Next.js Server Actions guidance, client-side validation is UX-only and
// the server must always re-validate untrusted input against this same
// schema.
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
