
## From 03-01 execution

- **Pre-existing `tsc --noEmit` error** in `app/layout.tsx:48` — `Cannot find name 'LayoutProps'`. Unrelated to plan 03-01's files (migration + `lib/pricing/*`); introduced in a prior phase commit (`a2f0cd0` or earlier). Not fixed here per scope boundary (out-of-scope file). Flagging for a future plan/cleanup pass.
