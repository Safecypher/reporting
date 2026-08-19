# Deferred Items

Out-of-scope issues discovered during plan execution, logged but not fixed
per the executor scope boundary (only fix issues caused by the current
task's changes).

## From 01-04 execution

- `app/layout.tsx(47,50): error TS2304: Cannot find name 'LayoutProps'` —
  pre-existing `tsc --noEmit` failure, present at the base commit (`d78e1d3`)
  before this plan's changes. Unrelated to `lib/ingestion/`. Not fixed here;
  flag for whichever plan next touches `app/layout.tsx`.
