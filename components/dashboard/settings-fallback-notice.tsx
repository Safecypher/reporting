/**
 * SettingsFallbackNotice — a small, presentational, scoped notice rendered
 * when `fetchAlignmentSettings()` could not read `app_settings` (WR-03,
 * ALIGN-06, T-06G-22).
 *
 * This is NOT a page-level error state and NOT a dialog — the page still
 * renders every card/tile with the substituted default tolerance and
 * baseline offset; this notice only says so. It carries `role="status"`
 * rather than `role="alert"` (the treatment
 * `components/settings/alignment-settings-form.tsx` reserves for a
 * rejected form submit): this is a degraded-but-rendering condition, not a
 * submit rejection, and the two must stay visually distinguishable
 * (UI-SPEC E7). Muted rather than destructive tone, wrapping to multiple
 * lines rather than truncating -- the same rule the existing always-visible
 * scope-impact notice follows.
 *
 * The component does not decide whether to render — the calling pattern is
 * "render it only when the error is non-null" at each of the three
 * verdict-rendering call sites, so that decision reads explicitly at every
 * call site rather than being hidden inside this component.
 */
export function SettingsFallbackNotice() {
  return (
    <p
      role="status"
      className="rounded-lg border border-border bg-muted/50 p-3 text-sm font-light text-muted-foreground"
    >
      Using default tolerance and baseline offset — alignment settings could not be loaded. The
      figures shown here are computed from those defaults.
    </p>
  );
}
