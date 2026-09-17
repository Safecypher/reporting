---
schema_version: 1
open_count: 6
waived_count: 0
fixed_count: 1
total_count: 7
last_updated: 2026-09-17T17:23:34.127Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 05 | unrun-verify | components/pricing/pricing-tier-form.tsx |  | 375px-viewport readability backstop (must_haves D11) and general on-screen appearance of the create/edit mode statement + inline supersede notice (D1/D4) not visually verified in 05-07 — logic is unit-tested, rendering is not; flagged for end-of-phase UAT (05-UAT.md) | open |  | 2026-09-10T17:26:11.979Z |  |
| 2 | 06 | unrun-verify | lib/dashboard/alignment-drill.ts |  | ingested_files(file_name) PostgREST FK embed on apigee_calls/card_inventory/removed_cards/verifications contributing-row selects has not been executed against the live Supabase project this session (RESEARCH.md Assumption A5) — no mcp__supabase__* tool was reachable from this executor | fixed |  | 2026-09-11T12:54:20.569Z | 2026-09-11T12:57:49.650Z |
| 3 | 06 | unrun-verify | lib/dashboard/alignment-drill.ts |  | Live-cards day-breakdown gap-change/settled derivation (fetchLiveCardsDayBreakdown, addBusinessDaysLocal) has no dedicated Vitest coverage — mirrors 0030's SQL by hand, unlike alignment-status.ts's tested truth table | open |  | 2026-09-11T12:54:20.651Z |  |
| 4 | 06 | unrun-verify | supabase/tests/tsys_msa_tier_test.sql |  | Blocks B and C (revenue-window boundary cases) are destructive if not run inside a true begin/rollback transaction — the Supabase MCP execute_sql path commits each statement separately, so running them as instructed would have permanently deleted every verification row and pricing tier set from live production. Only Block A (MSA tier boundaries) was executed and passed; B/C's revenue-window behaviour remains unverified against live data since Phase 5. The identical destructive-if-not-transactional pattern exists in supabase/tests/revenue_boundary_test.sql. Recommend converting both files to the fixture-free invariant style reconciliation_no_source_data_test.sql already uses. | open |  | 2026-09-11T13:22:47.100Z |  |
| 5 | 06 | unrun-verify | lib/dashboard/alignment.ts |  | 06-06 acceptance criterion 'No narrow cast remains around any alignment RPC call site' is NOT met: three (data ?? []) as unknown as <Row>[] casts remain at lines 123, 145 and 209. Root cause: lib/supabase/server.ts's createServerClient(...) has no Database type parameter, so every supabase.rpc() result is untyped; typing it surfaces a separate real conflict (5 errors) because Supabase's generator emits p_end: string instead of string \| null even though every alignment SQL function legitimately accepts NULL p_end for the open-ended all-time scope. The obvious fix (createServerClient<Database>) was tried and reverted. Casts are currently load-bearing, not sloppiness, but the criterion is unmet. lib/supabase/server.ts and lib/dashboard/alignment.ts are both out of 06-06's files_modified scope. Recommend follow-up: type the server client and widen the nullable p_end call sites, or adopt the .returns<T>() idiom the revenue page already uses. | open |  | 2026-09-11T13:22:47.191Z |  |
| 6 | 06 | lint-warning | public/icons.svg |  | Icon sprite renders every glyph as solid black, ignoring status colour -- no stroke= attrs on stroke-style symbols (e.g. alert/check), and only 5 elements use fill=currentColor. text-destructive/text-success/text-muted-foreground never reaches the glyph. Pre-existing, app-wide (~20 usage sites), found during 06-10 Task 3 human walkthrough. Does not corrupt any figure -- StatusBadge text label still carries meaning -- only the at-a-glance icon-colour affordance (SC5/ALIGN-05) is weakened. Follow-up: add stroke="currentColor" fill="none" (or equivalent) to the sprite's stroke-style symbols. Out of scope for 06-10 (WR-02/WR-03 only). | open |  | 2026-09-14T16:34:33.048Z |  |
| 7 | 08 | unrun-verify | lib/dashboard/period.ts |  | Task 4 no-regression proof (live before/after figures: 45450.00 MSA worked example, D-06 1200.0000>1050.0000, Aug/Sep revenue_forecast_daily sums) not run this session -- 08-01 executor has no Supabase MCP/DB access by design; needs orchestrator or 08-04 to capture before/after live figures once migration 0039 and this plan's clamp are both live | open |  | 2026-09-17T17:23:34.127Z |  |

````json
[
  {
    "id": 1,
    "kind": "unrun-verify",
    "phase": "05",
    "file": "components/pricing/pricing-tier-form.tsx",
    "line": null,
    "description": "375px-viewport readability backstop (must_haves D11) and general on-screen appearance of the create/edit mode statement + inline supersede notice (D1/D4) not visually verified in 05-07 — logic is unit-tested, rendering is not; flagged for end-of-phase UAT (05-UAT.md)",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-10T17:26:11.979Z",
    "resolved_at": null
  },
  {
    "id": 2,
    "kind": "unrun-verify",
    "phase": "06",
    "file": "lib/dashboard/alignment-drill.ts",
    "line": null,
    "description": "ingested_files(file_name) PostgREST FK embed on apigee_calls/card_inventory/removed_cards/verifications contributing-row selects has not been executed against the live Supabase project this session (RESEARCH.md Assumption A5) — no mcp__supabase__* tool was reachable from this executor",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-09-11T12:54:20.569Z",
    "resolved_at": "2026-09-11T12:57:49.650Z"
  },
  {
    "id": 3,
    "kind": "unrun-verify",
    "phase": "06",
    "file": "lib/dashboard/alignment-drill.ts",
    "line": null,
    "description": "Live-cards day-breakdown gap-change/settled derivation (fetchLiveCardsDayBreakdown, addBusinessDaysLocal) has no dedicated Vitest coverage — mirrors 0030's SQL by hand, unlike alignment-status.ts's tested truth table",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-11T12:54:20.651Z",
    "resolved_at": null
  },
  {
    "id": 4,
    "kind": "unrun-verify",
    "phase": "06",
    "file": "supabase/tests/tsys_msa_tier_test.sql",
    "line": null,
    "description": "Blocks B and C (revenue-window boundary cases) are destructive if not run inside a true begin/rollback transaction — the Supabase MCP execute_sql path commits each statement separately, so running them as instructed would have permanently deleted every verification row and pricing tier set from live production. Only Block A (MSA tier boundaries) was executed and passed; B/C's revenue-window behaviour remains unverified against live data since Phase 5. The identical destructive-if-not-transactional pattern exists in supabase/tests/revenue_boundary_test.sql. Recommend converting both files to the fixture-free invariant style reconciliation_no_source_data_test.sql already uses.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-11T13:22:47.100Z",
    "resolved_at": null
  },
  {
    "id": 5,
    "kind": "unrun-verify",
    "phase": "06",
    "file": "lib/dashboard/alignment.ts",
    "line": null,
    "description": "06-06 acceptance criterion 'No narrow cast remains around any alignment RPC call site' is NOT met: three (data ?? []) as unknown as <Row>[] casts remain at lines 123, 145 and 209. Root cause: lib/supabase/server.ts's createServerClient(...) has no Database type parameter, so every supabase.rpc() result is untyped; typing it surfaces a separate real conflict (5 errors) because Supabase's generator emits p_end: string instead of string | null even though every alignment SQL function legitimately accepts NULL p_end for the open-ended all-time scope. The obvious fix (createServerClient<Database>) was tried and reverted. Casts are currently load-bearing, not sloppiness, but the criterion is unmet. lib/supabase/server.ts and lib/dashboard/alignment.ts are both out of 06-06's files_modified scope. Recommend follow-up: type the server client and widen the nullable p_end call sites, or adopt the .returns<T>() idiom the revenue page already uses.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-11T13:22:47.191Z",
    "resolved_at": null
  },
  {
    "id": 6,
    "kind": "lint-warning",
    "phase": "06",
    "file": "public/icons.svg",
    "line": null,
    "description": "Icon sprite renders every glyph as solid black, ignoring status colour -- no stroke= attrs on stroke-style symbols (e.g. alert/check), and only 5 elements use fill=currentColor. text-destructive/text-success/text-muted-foreground never reaches the glyph. Pre-existing, app-wide (~20 usage sites), found during 06-10 Task 3 human walkthrough. Does not corrupt any figure -- StatusBadge text label still carries meaning -- only the at-a-glance icon-colour affordance (SC5/ALIGN-05) is weakened. Follow-up: add stroke=\"currentColor\" fill=\"none\" (or equivalent) to the sprite's stroke-style symbols. Out of scope for 06-10 (WR-02/WR-03 only).",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-14T16:34:33.048Z",
    "resolved_at": null
  },
  {
    "id": 7,
    "kind": "unrun-verify",
    "phase": "08",
    "file": "lib/dashboard/period.ts",
    "line": null,
    "description": "Task 4 no-regression proof (live before/after figures: 45450.00 MSA worked example, D-06 1200.0000>1050.0000, Aug/Sep revenue_forecast_daily sums) not run this session -- 08-01 executor has no Supabase MCP/DB access by design; needs orchestrator or 08-04 to capture before/after live figures once migration 0039 and this plan's clamp are both live",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-17T17:23:34.127Z",
    "resolved_at": null,
    "milestone": "v1.0"
  }
]
````
