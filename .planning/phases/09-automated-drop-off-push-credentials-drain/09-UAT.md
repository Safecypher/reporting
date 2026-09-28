---
status: complete
phase: 09-automated-drop-off-push-credentials-drain
source: [09-VERIFICATION.md]
started: 2026-09-28T13:45:00Z
updated: 2026-09-28T14:15:29Z
---

## Current Test

[testing complete]

## Tests

### 1. Manual drag-and-drop still works, single file
expected: Dragging one report file onto /uploads ingests it as before. The uploads-history row reads Source "Manual", and the underlying row has source = 'manual', source_ref null, source_credential_id null.
why_it_matters: This is AUTO-07 and the phase goal's second half — "the existing manual path keeps working exactly as before". The five pinned blob hashes prove `ingest()`, its types, the manual route, the dropzone and the batch module are byte-identical. But the manual path still traverses `lib/ingestion/supabase-writer.ts`, which WAS modified (additively) this phase, and now writes into a table with a new NOT NULL defaulted column. That is the gap a hash check cannot close.
result: issue
reported: "Source is set to \"Maual - unknown user\" but given I'm logged in, surely it should be attributed to me"
severity: major

### 2. Manual drag-and-drop still works, two files at once
expected: Dragging two files together shows the sequential continue-on-failure behaviour from quick task 260923-ili — per-file progress, per-file outcomes, and the summary toast. If one file fails the other still completes.
why_it_matters: Batch behaviour is the part most likely to regress silently, and it has its own prior quick-task history.
result: pass

### 3. /uploads shows push provenance
expected: The uploads history lists the two pushed proof files with `phase-09-live-proof` and `phase-09-cr01-recheck` in the Source column (not "Manual"), and expanding a row reveals the source_ref — the inbox object key returned to the sender.
why_it_matters: D-15/D-16. The whole thesis is that one string traces a sender's claim to a dashboard figure; this is where a human actually sees it.
result: pass

### 4. Rejections render as "Delivery rejected", not "Failed"
expected: The two zero-byte rejections appear in the /uploads list, interleaved by time with the ingested files, labelled "Delivery rejected" — a distinct label from "Failed". Both appear: two separate rows, not one.
why_it_matters: D-14's reason for existing. A refused delivery is not a failed parse, and two identical refusals must not collapse into one — that is what makes "this sender has failed every morning this week" visible.
result: pass

### 5. /settings/senders mint → reveal-once → revoke
expected: The page renders (it showed an error state until migration 0040 was applied). Minting a credential for a named sender reveals the full token exactly once, with a copy affordance; the token is not retrievable afterwards. The list shows every credential — including two live ones for the same sender name, since sender is deliberately not unique. Revoking one marks it revoked without deleting it.
why_it_matters: AUTO-04, and D-05's show-once rule. The credentials used in the live proof were minted by SQL because this environment has no browser session, so the UI mint path itself is unproven.
result: pass
note: "User reported: pass (although the two credentials that already existed had both been revoked already, and they senders were unique). The mint / reveal-once / revoke path is verified. The two-live-credentials-for-one-sender sub-assertion was NOT exercised — no live pair existed to observe. The rule itself is confirmed structurally: supabase/migrations/0040_push_delivery_spine.sql:44 declares sender with no unique constraint, pinned as locked decision D-02."
uncovered_sub_assertion: "Two live credentials for the same sender name both appear in the list (D-02 rotation overlap)"

### 6. Visual pass against the UI spec
expected: /settings/senders and the extended /uploads table match 09-UI-SPEC.md — spacing rhythm, badge neutrality, the token-reveal dialog's treatment, and the disclosure chevron behaviour.
why_it_matters: Deferred from plans 09-03 and 09-04, whose executors correctly routed browser-only visual checks to end-of-phase UAT.
result: pass

## Summary

total: 6
passed: 5
issues: 1
pending: 0
skipped: 0
blocked: 0

## Gaps

- gap_id: G-09-1
  truth: "The uploads-history Source column attributes a manual upload to the signed-in user who performed it"
  status: failed
  reason: "User reported: Source is set to \"Maual - unknown user\" but given I'm logged in, surely it should be attributed to me"
  severity: major
  test: 1
  root_cause: "lib/upload/history.ts:95 — mergeHistory() passes uploaderEmail: null unconditionally for every manual row, making sourceLabel()'s email branch unreachable in the render path. The identity is captured and read correctly upstream (app/api/ingest/route.ts:59 writes uploaded_by: user.id; app/(dashboard)/uploads/page.tsx:27 selects it) and discarded at the merge. The underlying blocker is that no id->email mechanism exists anywhere in the codebase — no profiles table, no view, no RPC; auth.users appears only as an FK target. /settings/pricing has the identical gap and renders the raw UUID (page.tsx:132)."
  artifacts:
    - path: "lib/upload/history.ts"
      issue: "mergeHistory hardcodes uploaderEmail: null (line 95), so the email branch of sourceLabel is dead code in production"
    - path: "app/(dashboard)/uploads/page.tsx"
      issue: "selects uploaded_by (line 27) but never resolves it to a display identity"
    - path: "app/(dashboard)/settings/pricing/page.tsx"
      issue: "same missing capability — renders raw changed_by UUID as the actor (line 132)"
  missing:
    - "An id->email resolution mechanism readable by authenticated users (profiles table synced from auth.users, or a SECURITY DEFINER view/RPC)"
    - "Plumb the resolved email through mergeHistory into sourceLabel for manual rows"
  debug_session: ""
  chosen_approach: "profiles table + trigger — a new migration adding a `profiles` table (id, email) mirroring auth.users, kept in sync by a trigger, readable under RLS by authenticated users. Chosen by Mark at UAT close. Scope includes fixing /settings/pricing's raw-UUID actor at the same time, since it is the same missing capability."

### Automated-verification note (pre-existing)

None found by automated verification — 5/5 ROADMAP success criteria are backed by code read in
full, with `npm test` 587/587, `tsc` clean, `lint` 0 errors and the five pinned manual-path blob
hashes all matching, each independently re-measured by the verifier rather than taken from the
summaries.

## Decision also needed

The live proof exercise left real rows in production, all accounted for:

- `ingested_files` 138 → 140 (the two pushed proof files)
- `verifications` 4705 → 4710 (5 rows, all matching `525346PH09PROOF%` or `525346CR01RECHK%`)
- `push_rejections` 2 rows (the two zero-byte refusals)
- a new `v_reconciliation_billing_daily` row for 2026-09-27 reading `no_source_data`, unsettled —
  the settling window correctly saying "counterpart not yet arrived", not a false mismatch

Both proof credentials are revoked; 0 remain live; the inbox is empty.

Keep them as an audit trail of the live proof, or remove them before Mark next looks at the
dashboard? Either is fine — say which.

**DECIDED (Mark, at UAT close):** keep them as an audit trail. They are real, correctly-labelled
data; the `no_source_data` reconciliation row is honestly reporting "counterpart not yet arrived"
rather than a false mismatch. The rows added by today's UAT manual-upload tests stay too.
