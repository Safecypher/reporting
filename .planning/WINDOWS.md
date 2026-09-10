---
schema_version: 1
open_count: 1
waived_count: 0
fixed_count: 0
total_count: 1
last_updated: 2026-09-10T17:26:11.979Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 05 | unrun-verify | components/pricing/pricing-tier-form.tsx |  | 375px-viewport readability backstop (must_haves D11) and general on-screen appearance of the create/edit mode statement + inline supersede notice (D1/D4) not visually verified in 05-07 — logic is unit-tested, rendering is not; flagged for end-of-phase UAT (05-UAT.md) | open |  | 2026-09-10T17:26:11.979Z |  |

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
  }
]
````
