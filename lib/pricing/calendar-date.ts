// RED-phase stub (05-09, G-05-CR01/WR-01): deliberately reproduces the
// insufficient implementation being replaced — a strict shape regex plus a
// `Date.parse` round trip. `Date.parse` only reports failure for a
// structurally malformed string; it silently ROLLS OVER an out-of-range
// month or day into the next unit instead of rejecting it, which is exactly
// the bug this module exists to fix. Left in place only long enough to prove
// the new tests fail for the right reason before the real implementation
// lands.
const SHAPE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidCalendarDate(value: string): boolean {
  return SHAPE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}
