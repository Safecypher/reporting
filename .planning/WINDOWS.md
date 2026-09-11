---
schema_version: 1
open_count: 2
waived_count: 0
fixed_count: 1
total_count: 3
last_updated: 2026-09-11T12:57:49.650Z
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
  }
]
````
