# Deferred Items — Phase 02

## app/layout.tsx: `Cannot find name 'LayoutProps'` (TS2304)

- **Found during:** 02-05 (removed-cards) `npx tsc --noEmit` verification step.
- **Scope:** Pre-existing, unrelated to `lib/ingestion/**` or `supabase/migrations/**`. Not introduced by this plan's files.
- **Action:** Not fixed — out of scope per executor scope-boundary rule. Logged here for a future plan/cleanup pass.
