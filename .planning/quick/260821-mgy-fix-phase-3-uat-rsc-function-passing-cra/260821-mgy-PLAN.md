---
phase: quick
plan: 260821-mgy
type: execute
wave: 1
depends_on: []
files_modified:
  - components/dashboard/verification-drill-columns.tsx
  - components/dashboard/verification-drill-sheet.tsx
  - components/dashboard/sla-breach-drill-sheet.tsx
  - components/dashboard/revenue-tier-drill-sheet.tsx
  - app/(dashboard)/verifications/page.tsx
  - app/(dashboard)/sla/page.tsx
  - app/(dashboard)/revenue/page.tsx
  - supabase/migrations/0016_delete_latest_pricing_tier_set.sql
  - app/(dashboard)/settings/pricing/actions.ts
  - app/(dashboard)/settings/pricing/page.tsx
  - components/pricing/delete-latest-tier-set.tsx
autonomous: true
requirements: [UAT-RSC-01, UAT-DELETE-01]

must_haves:
  truths:
    - "/verifications, /sla, /revenue render without the 'Functions cannot be passed directly to Client Components' RSC error"
    - "Drill-down Sheets on all three pages still open and render their column headers/cells"
    - "A user can delete ONLY the most recent pricing tier set from /settings/pricing, behind a confirmation dialog"
    - "Deleting the latest tier set records an attributed row in pricing_tier_audit that survives the delete"
  artifacts:
    - path: "components/dashboard/verification-drill-sheet.tsx"
      provides: "Client wrapper owning verification drill columns"
      contains: "use client"
    - path: "components/dashboard/sla-breach-drill-sheet.tsx"
      provides: "Client wrapper owning SLA breach drill columns"
      contains: "use client"
    - path: "components/dashboard/revenue-tier-drill-sheet.tsx"
      provides: "Client wrapper owning revenue-tier drill columns"
      contains: "use client"
    - path: "supabase/migrations/0016_delete_latest_pricing_tier_set.sql"
      provides: "Nullable audit FK + delete_latest_pricing_tier_set RPC"
      contains: "delete_latest_pricing_tier_set"
    - path: "components/pricing/delete-latest-tier-set.tsx"
      provides: "Confirmation-dialog delete control"
      contains: "use client"
  key_links:
    - from: "app/(dashboard)/verifications/page.tsx"
      to: "components/dashboard/verification-drill-sheet.tsx"
      via: "renders VerificationDrillSheet with serializable rows only (no columns prop)"
      pattern: "VerificationDrillSheet"
    - from: "app/(dashboard)/settings/pricing/actions.ts"
      to: "delete_latest_pricing_tier_set"
      via: "supabase.rpc"
      pattern: "delete_latest_pricing_tier_set"
---

<objective>
Fix the two Phase 3 UAT issues found in real testing.

1. BUG (primary): the RSC "Functions cannot be passed directly to Client Components"
   error on /verifications, /sla, and /revenue. TanStack column definitions whose
   `header`/`cell` are render *functions* are constructed in async Server Components
   (the pages) and passed as the `columns` prop into the client `DrillSheet`. Next 16
   cannot serialize functions across the server->client boundary, so it throws at
   request-render time (which is why `tsc` and `next build` both passed — the throw
   fires during the dynamic route render, not the build).

2. FEATURE: a "delete latest pricing tier set" control on /settings/pricing so a user
   who accidentally saved a tier set can correct it. Only the most recent set (max
   effective_from) may be deleted, and the deletion is recorded in pricing_tier_audit.

Purpose: unblock the dashboard demo (the render bug makes three core pages unusable)
and give the pricing admin a safe correction path.
Output: three client drill-sheet wrappers, updated pages, migration 0016, a delete
Server Action, and a confirmation-dialog delete control.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md

<interfaces>
<!-- Contracts the executor needs; extracted from the codebase. Use directly. -->

DrillSheet (components/dashboard/drill-sheet.tsx) — 'use client', generic:
```
interface DrillSheetProps<TRow> {
  filter: DrillFilter | null;
  rows: TRow[];
  columns: ColumnDef<TRow, any>[];   // function-bearing — must originate in client code
  title: string;
  loading?: boolean;
  totalCount?: number | null;
}
export function DrillSheet<TRow>(props: DrillSheetProps<TRow>): JSX.Element;
```

verification-drill-columns.tsx exports:
  export const verificationDrillColumns: ColumnDef<VerificationDrillRow, any>[];

lib/dashboard/verification-drill.ts exports:
  interface VerificationDrillRow { created_at, external_card_reference, duration_ms, authenticated }
  interface VerificationDrillFetchResult { rows: VerificationDrillRow[]; totalCount: number | null }
  fetchVerificationDrillRows(supabase, authenticated?: boolean): Promise<VerificationDrillFetchResult>

lib/dashboard/drill-params.ts exports DrillFilter (plain, serializable) and parseDrillParams.

pricing_tier_audit (0011): `tier_set_id uuid not null references pricing_tier_sets(id)`
  (FK name `pricing_tier_audit_tier_set_id_fkey`), select-only RLS for authenticated,
  NO client insert policy — audit rows are written ONLY by SECURITY DEFINER functions.

pricing_tier_sets (0011): select + insert RLS for authenticated, NO delete policy.
  FK pricing_tiers.tier_set_id -> pricing_tier_sets(id) ON DELETE CASCADE.

save_pricing_tier_set RPC (0015) — mirror its revoke/grant + errcode='check_violation'
  + `set search_path = public` conventions. The existing SECURITY DEFINER audit trigger
  fn_pricing_tier_sets_audit() proves auth.uid() attributes correctly inside a definer
  function within the session.

dialog.tsx exports: Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger. (No alert-dialog is installed — use Dialog.)
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix RSC boundary — move function-bearing columns into client wrappers</name>
  <files>components/dashboard/verification-drill-columns.tsx, components/dashboard/verification-drill-sheet.tsx, components/dashboard/sla-breach-drill-sheet.tsx, components/dashboard/revenue-tier-drill-sheet.tsx, app/(dashboard)/verifications/page.tsx, app/(dashboard)/sla/page.tsx, app/(dashboard)/revenue/page.tsx</files>
  <read_first>
    - components/dashboard/drill-sheet.tsx (the client DrillSheet consuming columns)
    - components/dashboard/verification-drill-columns.tsx
    - app/(dashboard)/verifications/page.tsx (lines 205-211 — DrillSheet render)
    - app/(dashboard)/sla/page.tsx (lines 42-66 inline slaBreachDrillColumns; 304-309 render)
    - app/(dashboard)/revenue/page.tsx (lines 26-65 inline columns + currencyFormatter; 414-426 render)
  </read_first>
  <action>
Root cause: the async Server Component pages create/import TanStack column defs (whose
header/cell are functions) and pass them as `columns={...}` into the client `DrillSheet`.
Fix by ensuring every object containing a function is created INSIDE client code; pages
pass only serializable data (rows, filter, title, totalCount).

1. Add `"use client";` as the first line of `verification-drill-columns.tsx` (it holds
   JSX render functions; make its client-only nature explicit so it can never be pulled
   into a server render).

2. Create `components/dashboard/verification-drill-sheet.tsx` ('use client'): import
   `verificationDrillColumns`, the `VerificationDrillRow` type, and `DrillSheet`. Export
   `VerificationDrillSheet` with props `{ filter: DrillFilter | null; rows: VerificationDrillRow[]; title: string; totalCount?: number | null }` that renders `<DrillSheet columns={verificationDrillColumns} {...props} />`. The columns now originate in client code.

3. Create `components/dashboard/sla-breach-drill-sheet.tsx` ('use client'): MOVE the
   `SlaBreachDrillRow` interface, `slaBreachColumnHelper`, and `slaBreachDrillColumns`
   out of sla/page.tsx into this file. Export both the `SlaBreachDrillRow` type and a
   `SlaBreachDrillSheet` component with props `{ filter: DrillFilter | null; rows: SlaBreachDrillRow[]; title: string }` rendering `<DrillSheet columns={slaBreachDrillColumns} {...props} />`.

4. Create `components/dashboard/revenue-tier-drill-sheet.tsx` ('use client'): MOVE the
   `RevenueTierDrillRow` interface, `currencyFormatter`, `revenueTierColumnHelper`, and
   `revenueTierDrillColumns` out of revenue/page.tsx into this file. Export the
   `RevenueTierDrillRow` type and a `RevenueTierDrillSheet` component with props
   `{ filter: DrillFilter | null; rows: RevenueTierDrillRow[]; title: string }`.

5. Update `verifications/page.tsx`: remove the `verificationDrillColumns` import; keep the
   `verificationDrillTitle` helper. Replace the `<DrillSheet ... columns={verificationDrillColumns} .../>` with `<VerificationDrillSheet filter={...} rows={drillResult.rows} title={...} totalCount={drillResult.totalCount} />`. No `columns` prop crosses the boundary.

6. Update `sla/page.tsx`: delete the now-moved inline column/type block; drop the
   `createColumnHelper`/`ColumnDef` imports if they become unused. Import `SlaBreachDrillSheet`
   and the `SlaBreachDrillRow` type from the new wrapper. Keep `fetchSlaBreachDrillRows` in
   the page (server-side), typed to return `SlaBreachDrillRow[]` from the wrapper module.
   Replace the DrillSheet render with `<SlaBreachDrillSheet filter={...} rows={drillRows} title={...} />`.

7. Update `revenue/page.tsx`: delete the moved inline column/type/formatter block and any
   now-unused `createColumnHelper`/`ColumnDef` imports; import `VerificationDrillSheet`,
   `RevenueTierDrillSheet`, and the `RevenueTierDrillRow` type. Keep `fetchRevenueTierDrillRows`
   in the page, typed to `RevenueTierDrillRow[]`. Replace BOTH DrillSheet renders with
   `<VerificationDrillSheet .../>` and `<RevenueTierDrillSheet .../>`.

Do not change DrillSheet itself — it stays the generic client component, now only ever
rendered by these client wrappers. Keep every ColumnDef definition byte-for-byte the
same (headers/cells) so the drill tables look identical.
  </action>
  <verify>
    <automated>test -z "$(grep -rl 'columns={' 'app/(dashboard)')" && echo "OK: no server page passes a columns prop"</automated>
    <automated>for f in components/dashboard/verification-drill-columns.tsx components/dashboard/verification-drill-sheet.tsx components/dashboard/sla-breach-drill-sheet.tsx components/dashboard/revenue-tier-drill-sheet.tsx; do head -1 "$f" | grep -q "use client" || { echo "MISSING use client: $f"; exit 1; }; done && echo "OK: column-bearing modules are client"</automated>
    <automated>npx tsc --noEmit</automated>
    <human-check>Run `npm run dev`, log in, and load /verifications, /sla, and /revenue (and open each drill Sheet). Confirm NONE show the "Functions cannot be passed directly to Client Components" error overlay and the drill tables render headers + cells as before.</human-check>
  </verify>
  <done>No `columns={` prop appears under app/(dashboard); the four column-bearing modules are `'use client'`; `tsc --noEmit` is clean; all three routes render without the RSC serialization error.</done>
  <acceptance_criteria>
    - verifications/sla/revenue pages pass only serializable data (rows/filter/title/totalCount) to the drill wrappers.
    - Drill Sheets on all three pages still open and render identical columns.
    - No behavioural change to fetchers, RLS, or query logic.
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 2: Write migration 0016 — nullable audit FK + delete_latest_pricing_tier_set RPC</name>
  <files>supabase/migrations/0016_delete_latest_pricing_tier_set.sql</files>
  <read_first>
    - supabase/migrations/0011_pricing_tiers.sql (audit table + FK + audit trigger)
    - supabase/migrations/0015_pricing_tier_integrity.sql (RPC + revoke/grant conventions to mirror)
  </read_first>
  <action>
Create ONLY the migration file (the executor cannot push migrations — no supabase CLI /
SUPABASE_ACCESS_TOKEN). The orchestrator applies it to the live DB via Supabase MCP and
regenerates types/db.ts afterward — do NOT hand-edit types/db.ts here.

Header comment: explain this closes the UAT gap (accidental tier-set save cannot be
corrected) and note the deviation from a plain SECURITY INVOKER RPC (see below).

Part 1 — make the audit FK survivable:
- `alter table pricing_tier_audit drop constraint pricing_tier_audit_tier_set_id_fkey;`
- `alter table pricing_tier_audit alter column tier_set_id drop not null;`
- re-add: `alter table pricing_tier_audit add constraint pricing_tier_audit_tier_set_id_fkey foreign key (tier_set_id) references pricing_tier_sets(id) on delete set null;`
  So the deletion audit row survives after the set row is gone (its tier_set_id becomes NULL).

Part 2 — `delete_latest_pricing_tier_set(p_tier_set_id uuid) returns void`:
- Use `language plpgsql`, `set search_path = public`, and **SECURITY DEFINER** — NOT
  SECURITY INVOKER. This is a deliberate, required deviation from the brief's wording:
  pricing_tier_sets has NO delete RLS policy and pricing_tier_audit has NO client insert
  policy, so a SECURITY INVOKER call by an authenticated user would be RLS-denied on BOTH
  the audit INSERT and the pricing_tier_sets DELETE. SECURITY DEFINER (running as table
  owner) is exactly the pattern 0011's fn_pricing_tier_sets_audit() uses, and auth.uid()
  still resolves to the real acting user inside the definer function within the session —
  so D-06 attribution is preserved and the delete path stays locked to this guarded RPC
  (no broad DELETE policy is opened on pricing_tier_sets). Document this rationale inline.
- Logic, in order:
  1. Select the effective_from of p_tier_set_id and max(effective_from) across
     pricing_tier_sets. If p_tier_set_id does not exist, raise (errcode 'check_violation').
  2. If the set's effective_from is not the max (i.e. it is not the latest set), raise
     with errcode 'check_violation' and a clear message ("only the most recent pricing
     tier set can be deleted").
  3. INSERT into pricing_tier_audit (tier_set_id, changed_by, summary) VALUES
     (p_tier_set_id, auth.uid(), 'Deleted pricing tier set effective ' || <effective_from>::text)
     — BEFORE the delete, while the FK target still exists.
  4. `delete from pricing_tier_sets where id = p_tier_set_id;` — pricing_tiers cascade-delete;
     the ON DELETE SET NULL from Part 1 nulls the just-inserted audit row's tier_set_id but
     keeps its summary (the deferred CR-03 validate trigger returns early when a set's tiers
     are all gone, so the cascade is clean).
- Permissions, mirroring 0015:
  `revoke execute on function delete_latest_pricing_tier_set(uuid) from public;`
  `revoke execute on function delete_latest_pricing_tier_set(uuid) from anon;`
  `grant execute on function delete_latest_pricing_tier_set(uuid) to authenticated;`
- Add a `comment on function` summarising the guard + SECURITY DEFINER rationale.

Do NOT modify 0011-0015 (already applied/live). Keep all money/date columns exact — no
floats introduced.
  </action>
  <verify>
    <automated>test -f supabase/migrations/0016_delete_latest_pricing_tier_set.sql && grep -q "delete_latest_pricing_tier_set" supabase/migrations/0016_delete_latest_pricing_tier_set.sql && echo "OK: migration present"</automated>
    <automated>grep -q "security definer" supabase/migrations/0016_delete_latest_pricing_tier_set.sql && grep -q "on delete set null" supabase/migrations/0016_delete_latest_pricing_tier_set.sql && grep -q "grant execute" supabase/migrations/0016_delete_latest_pricing_tier_set.sql && echo "OK: definer + nullable FK + grant present"</automated>
  </verify>
  <done>Migration 0016 exists, drops+nulls+re-adds the audit FK with ON DELETE SET NULL, defines the SECURITY DEFINER guarded RPC with correct revoke/grant, and does not touch prior migrations.</done>
  <acceptance_criteria>
    - RPC rejects deletion of any set that is not max(effective_from) with a check_violation.
    - Audit row is written (attributed to auth.uid()) before delete and survives it as a NULL-FK summary row.
    - Executor SUMMARY explicitly flags that 0016 must be pushed by the orchestrator and types/db.ts regenerated.
  </acceptance_criteria>
</task>

<task type="auto">
  <name>Task 3: Delete Server Action + confirmation-dialog UI on /settings/pricing</name>
  <files>app/(dashboard)/settings/pricing/actions.ts, components/pricing/delete-latest-tier-set.tsx, app/(dashboard)/settings/pricing/page.tsx</files>
  <read_first>
    - app/(dashboard)/settings/pricing/actions.ts (savePricingTierSet — mirror its session-client + friendlyError pattern)
    - app/(dashboard)/settings/pricing/page.tsx (PricingBody — where to fetch the latest set + render the control)
    - components/pricing/pricing-tier-form.tsx (client toast/error UX to mirror)
    - components/ui/dialog.tsx (Dialog primitives)
  </read_first>
  <action>
1. actions.ts — add `deleteLatestPricingTierSet(tierSetId: string)`:
   - `"use server"` module already. Use the SESSION-SCOPED `createClient()` from
     `@/lib/supabase/server` (so auth.uid() attribution works inside the RPC).
   - Guard: `const { data: { user } } = await supabase.auth.getUser(); if (!user) return { error: "Unauthorized" };`
   - Call the RPC. types/db.ts will NOT contain `delete_latest_pricing_tier_set` until the
     orchestrator regenerates types after applying 0016, so a direct `supabase.rpc("delete_latest_pricing_tier_set", ...)` will fail tsc against the stale types. Use a NARROWLY-SCOPED cast with an explanatory comment (do not weaken types broadly), e.g. cast just the rpc call:
     `const { error } = await (supabase.rpc as unknown as (fn: string, args: { p_tier_set_id: string }) => Promise<{ error: { message: string } | null }>)("delete_latest_pricing_tier_set", { p_tier_set_id: tierSetId });`
     Add a comment: "// types/db.ts lacks this RPC until orchestrator regenerates after 0016 — narrow cast only."
   - Mirror savePricingTierSet's error handling: on error, `console.error(...)` the raw
     message server-side, and return `{ error }` with friendly copy (map the
     'only the most recent' / check_violation message to something like "Only the most
     recent pricing tier set can be deleted." else a generic delete-failed message).
   - On success: `revalidatePath("/settings/pricing"); revalidatePath("/revenue");` and
     return `{ success: true }`.
   - Return type: `Promise<{ success: true } | { error: string }>`.

2. components/pricing/delete-latest-tier-set.tsx ('use client') — the confirmation control:
   - Props `{ tierSetId: string; effectiveFrom: string }`.
   - Render a destructive-styled Button that opens a `Dialog` (from components/ui/dialog).
     DialogContent: DialogHeader/DialogTitle "Delete latest pricing tier set?",
     DialogDescription explaining it removes the set effective <effectiveFrom> and is
     recorded in the change history, and cannot be undone. DialogFooter: a Cancel
     (DialogClose) and a confirm Button.
   - On confirm: call `deleteLatestPricingTierSet(tierSetId)`; on `success` show a
     `toast.success(...)` and close the dialog; on `error` show `toast.error(result.error)`
     (mirror pricing-tier-form.tsx's sonner usage). Disable the confirm button while
     the action is pending (useState/useTransition).

3. page.tsx (PricingBody) — fetch the latest set and render the control:
   - Add to the server fetch: `supabase.from("pricing_tier_sets").select("id, effective_from").order("effective_from", { ascending: false }).limit(1).maybeSingle()`.
     Fold a query error into the existing ErrorState path.
   - When a latest set exists, render `<DeleteLatestTierSet tierSetId={row.id} effectiveFrom={row.effective_from} />` (only serializable strings cross the boundary). Place it near the PricingTierForm (e.g. below it) with a small heading. Render nothing when no set exists.
  </action>
  <verify>
    <automated>grep -q "deleteLatestPricingTierSet" "app/(dashboard)/settings/pricing/actions.ts" && grep -q "delete_latest_pricing_tier_set" "app/(dashboard)/settings/pricing/actions.ts" && echo "OK: action wired to RPC"</automated>
    <automated>head -1 components/pricing/delete-latest-tier-set.tsx | grep -q "use client" && grep -q "Dialog" components/pricing/delete-latest-tier-set.tsx && echo "OK: client dialog control"</automated>
    <automated>grep -q "DeleteLatestTierSet" "app/(dashboard)/settings/pricing/page.tsx" && echo "OK: control rendered on page"</automated>
    <automated>npx tsc --noEmit</automated>
    <human-check>After the orchestrator applies migration 0016 and regenerates types: on /settings/pricing, click Delete, confirm in the dialog, and verify the latest tier set is removed, a "Deleted pricing tier set effective ..." row appears in Change history, and /revenue reflects the removal. (This step is post-execution because the RPC does not exist in the DB until 0016 is pushed.)</human-check>
  </verify>
  <done>Server Action calls the RPC via the session client with a narrowly-scoped cast; a confirmation Dialog control renders only when a tier set exists and shows toast feedback; `tsc --noEmit` is clean.</done>
  <acceptance_criteria>
    - Action uses the session-scoped client (auth.uid() attribution) and friendly error mapping mirroring savePricingTierSet.
    - Delete is two-step (Dialog confirm), never one-click.
    - Control is hidden when no tier set exists.
    - SUMMARY notes that end-to-end delete verification depends on the orchestrator pushing 0016 + regenerating types.
  </acceptance_criteria>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser -> Server Action | `deleteLatestPricingTierSet` is an untrusted entry point; `tierSetId` is attacker-controllable |
| Server Action -> Postgres RPC | RLS + RPC guard are the real enforcement, not the UI |
| Server Component -> Client Component | function-bearing props must not cross (the fixed bug) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-Q-01 | Tampering | delete RPC called with a non-latest `tier_set_id` | mitigate | RPC raises check_violation unless the id is the max(effective_from) set — enforced in Postgres, not the UI |
| T-Q-02 | Repudiation | pricing-set deletion with no trace | mitigate | audit row inserted (auth.uid()) before delete; ON DELETE SET NULL keeps the summary after the set is gone |
| T-Q-03 | Elevation of Privilege | SECURITY DEFINER RPC over-broad | mitigate | `set search_path = public`; execute revoked from public/anon, granted only to authenticated; delete path exists ONLY through this guarded RPC (no DELETE RLS policy opened) |
| T-Q-04 | Information Disclosure | raw Postgres error text reaching UI | mitigate | action logs raw error server-side, returns friendly mapped copy (mirrors WR-01) |
| T-Q-SC | Tampering | npm/pip/cargo installs | accept | no new packages installed — all UI primitives (dialog, sonner, tanstack) already present |
</threat_model>

<verification>
- `npx tsc --noEmit` clean across the whole repo.
- No `columns={` prop under app/(dashboard); all four column-bearing modules are `'use client'`.
- Dev-server load of /verifications, /sla, /revenue shows no RSC serialization error and drill Sheets render (human-check).
- Migration 0016 present, self-consistent (definer + nullable FK + grant), prior migrations untouched.
- Delete control renders behind a Dialog and only when a tier set exists.
</verification>

<success_criteria>
- The three dashboard pages render and drill without the "Functions cannot be passed directly to Client Components" error.
- /settings/pricing offers a guarded delete of ONLY the latest tier set, recorded in the audit trail.
- All automated gates pass; SUMMARY flags 0016 for orchestrator push + type regeneration.
</success_criteria>

<output>
Create `.planning/quick/260821-mgy-fix-phase-3-uat-rsc-function-passing-cra/260821-mgy-SUMMARY.md` when done.
Explicitly record in the SUMMARY: (1) migration 0016 must be applied by the orchestrator
via Supabase MCP and types/db.ts regenerated afterward; (2) the narrowly-scoped rpc cast
in actions.ts is temporary and can be removed once types are regenerated; (3) the
SECURITY DEFINER deviation from the brief's "SECURITY INVOKER" wording and why.
</output>
