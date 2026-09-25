---
phase: 09-automated-drop-off-push-credentials-drain
plan: 03
subsystem: ui
tags: [nextjs, react-hook-form, zod, supabase, shadcn, radix-dialog, settings, server-actions]

requires:
  - phase: 09-01 (Push Delivery Spine)
    provides: "push_credentials + push_credentials_audit schema (written, not yet applied live), lib/push/tokens.ts's generateToken/hashToken, lib/push/tables.ts's untyped pushTable/pushRpc accessor"
provides:
  - "/settings/senders — mint / show-once-reveal / revoke UI for push credentials, cloning /settings/general's page structure object-for-object"
  - "lib/push/schema.ts — mintCredentialSchema/revokeCredentialSchema, the single source of truth for both the client form and the Server Actions"
  - "lib/push/credentials.ts — pure list-presentation rules (sortCredentials, rotatingSenders, isSoleLiveCredential, distinctSenders, formatLastUsed, isLiveCredential) with no DOM dependency"
  - "issuePushCredential / revokePushCredential Server Actions (app/(dashboard)/settings/senders/actions.ts), session-scoped so auth.uid() reaches fn_push_credentials_audit()"
  - "SETTINGS_ITEMS gains a Senders entry nested under the existing Settings sidebar group"
affects: [09-05]

actuals:
  tokens: 11476
  tasks: 3
  commits: 4
plan_head_before: 2f96e357e5f08478d898f2324d305a4ca8d9c3c0

tech-stack:
  added: []
  patterns:
    - "Show-once secret pattern: the complete token exists only in issuePushCredential's success return and TokenRevealDialog's props for the life of the dialog — never logged, stored, or put in the URL. Dialog dismissal (outside-click, Escape) is explicitly suppressed via Radix's onInteractOutside/onEscapeKeyDown preventDefault, with showCloseButton={false} removing the default X affordance; the only closing control is an explicit acknowledgment button."
    - "Sender-suggestion chip row as a presentational typo mitigation for a deliberately-non-unique sender column (D-02) — the mitigation is UI (show what already exists so an operator picks rather than retypes), not a database constraint."
    - "CredentialsTable takes an optional renderAction prop rather than importing RevokeCredential directly, so Task 2's presentational table could build and pass its own verification gate before Task 3's RevokeCredential component existed; Task 3 wires it in from the page only, with no further edit to the table itself."

key-files:
  created:
    - lib/push/schema.ts
    - lib/push/credentials.ts
    - lib/push/__tests__/senders.test.ts
    - app/(dashboard)/settings/senders/actions.ts
    - app/(dashboard)/settings/senders/page.tsx
    - components/settings/credentials-table.tsx
    - components/settings/mint-credential-form.tsx
    - components/settings/token-reveal-dialog.tsx
    - components/settings/revoke-credential.tsx
  modified:
    - components/app-shell/settings-nav.tsx

key-decisions:
  - "distinctSenders includes senders whose only credentials are revoked, not just live ones — a sender identity that existed once is still worth suggesting over retyping it, since the chip row's entire purpose is preventing an accidental near-duplicate identity."
  - "CredentialsTable's action cell is driven by an optional renderAction prop rather than a direct import of RevokeCredential, decoupling Task 2's table from Task 3's not-yet-written revoke control."
  - "revokePushCredential's already-revoked case is modeled as an {error} result rather than a third success variant, so the existing toast-on-error/dialog-stays-open branch in RevokeCredential handles it with no extra branching — a revoke that quietly matched zero rows is exactly the kind of silent lie D-14's sibling decisions in this phase were written to eliminate."

patterns-established:
  - "Show-once secret dialogs suppress both Radix dismissal paths explicitly (onInteractOutside/onEscapeKeyDown preventDefault) rather than relying on a controlled open prop alone — a future secret-reveal surface in this codebase should follow the same two-suppression pattern."

requirements-completed: [AUTO-04]

coverage:
  - id: D1
    description: "An operator can mint a push credential for a named sender from /settings/senders with no SQL console, through a session-scoped write so fn_push_credentials_audit() attributes the issue to the acting user (D-01, D-03, AUTO-04)"
    requirement: "AUTO-04"
    verification:
      - kind: unit
        ref: "lib/push/__tests__/senders.test.ts#issuePushCredential"
        status: pass
      - kind: other
        ref: "grep gate: no SUPABASE_SECRET_KEY/buildSecretClient import under app/(dashboard)/settings/senders"
        status: pass
    human_judgment: true
    rationale: "The unit suite proves the auth guard, the persisted payload (digest + prefix only, never the token), and the shape guarantee that only the mint success path carries a token, all against a stubbed Supabase client. It does not exercise a live mint against the real Supabase project — push_credentials is written but not yet applied live (that is plan 09-05's task) — nor the actual browser reveal-dialog experience, which this repo has no jsdom/React Testing Library to assert. Deferred to the phase-level UAT consolidation per workflow.human_verify_mode: end-of-phase (the project default, unchanged in config.json)."
  - id: D2
    description: "The complete token is displayed exactly once, at generation, and the reveal dialog cannot be dismissed by an outside click or the Escape key — only the explicit acknowledgment button closes it (D-05)"
    verification:
      - kind: other
        ref: "grep gate: onInteractOutside/onEscapeKeyDown preventDefault present in components/settings/token-reveal-dialog.tsx"
        status: pass
      - kind: unit
        ref: "lib/push/__tests__/senders.test.ts#issuePushCredential returns the complete token exactly once, alongside the prefix and sender"
        status: pass
    human_judgment: true
    rationale: "The grep gate proves both dismissal paths are structurally suppressed in source, and the unit test proves the token exists on exactly one return path. Whether the dialog genuinely feels undismissable in a real browser (clicking outside truly does nothing, Escape truly does nothing, the clipboard copy toast and failure path behave as specified) is UI behaviour this suite cannot exercise and is deferred to phase UAT."
  - id: D3
    description: "A sender may hold more than one live credential; the list never collapses to one row per sender, a sender with two-or-more live credentials shows the Rotating badge on every one of its live rows, and the revoke confirmation escalates its warning only when the target is the sender's sole live credential (D-02, D-04, AUTO-04)"
    verification:
      - kind: unit
        ref: "lib/push/__tests__/senders.test.ts#sortCredentials / #rotatingSenders / #isSoleLiveCredential"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every issue and revoke is attributable and durable: the audit trigger (not client code) writes push_credentials_audit, and revoking an already-revoked credential returns an explicit result rather than a silent success (D-03, AUTO-04)"
    verification:
      - kind: unit
        ref: "lib/push/__tests__/senders.test.ts#revokePushCredential"
        status: pass
    human_judgment: false
  - id: D5
    description: "The full 09-UI-SPEC.md screen contract for /settings/senders — empty/loading/error states, long-text truncation with a title tooltip, the copywriting-table strings verbatim, and the spacing/typography/colour rules (two font weights only, accent reserved for four things, no new icons.svg symbol) — is followed"
    verification: []
    human_judgment: true
    rationale: "Visual/UX adequacy is a judgment call this repo's test suite cannot assert (no jsdom/React Testing Library). Task 2 and Task 3's own <human-check> blocks name the exact things to confirm in a browser (page rhythm, font weights, badge neutrality, tooltip truncation, the reveal/copy/revoke flow end to end); deferred to the phase-level UAT consolidation per workflow.human_verify_mode: end-of-phase."

duration: 45min
completed: 2026-09-25
status: complete
---

# Phase 9 Plan 3: /settings/senders — Mint, Show Once, Revoke Summary

**A cloned-from-/settings/general operator page where mint/reveal-once/revoke of push credentials runs entirely through session-scoped, Zod-validated Server Actions — proved by 24 new unit tests over the shared schemas, every pure list-presentation rule, and the shape guarantee that only one return path in the whole module ever carries a token.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-09-25 (continuation session, immediately following 09-02)
- **Completed:** 2026-09-25
- **Tasks:** 3 (contracts + write path; page shell + list + sidebar entry; mint/reveal/revoke UI)
- **Files modified:** 10 (9 created, 1 modified — excluding `.planning/`)

## Accomplishments

- `lib/push/schema.ts`: `mintCredentialSchema` (trim, 1–100 chars) and `revokeCredentialSchema` (uuid), the single source of truth for both the client forms and the Server Actions.
- `lib/push/credentials.ts`: every list-presentation rule as a pure, unit-tested function — `sortCredentials` (sender ascending `en-GB` collation, then created-at descending, stable), `rotatingSenders`, `isSoleLiveCredential`, `distinctSenders` (exact-string-equality, so "TSYS" and "tsys" surface as two distinct suggestion chips), `formatLastUsed`, and `isLiveCredential`.
- `app/(dashboard)/settings/senders/actions.ts`: `issuePushCredential` and `revokePushCredential`, both session-scoped (never the secret-key client, guarded by an automated grep), both refusing an unauthenticated caller before any query. Mint returns the complete token exactly once; revoke on zero affected rows returns an explicit "already revoked" result instead of a silent success.
- `app/(dashboard)/settings/senders/page.tsx`: clones `/settings/general`'s `PageHeader` / `Suspense`+`LoadingState` / `ErrorState` / `Separator`-rhythm structure exactly, reading both `push_credentials` and the 50 most recent `push_credentials_audit` rows through `lib/push/tables.ts`'s untyped accessor (types/db.ts regeneration is plan 09-05's job).
- `components/settings/credentials-table.tsx`: one row per credential — never one row per sender — with the sender/prefix/created/last-used/status columns, the neutral "Rotating" and "Revoked" badges, the dashed-border empty state, and a deliberately uncapped, unpaginated list.
- `components/settings/mint-credential-form.tsx` + `token-reveal-dialog.tsx` + `revoke-credential.tsx`: the sender-suggestion chip row (typo mitigation for D-02's deliberately non-unique `sender` column), the show-once reveal dialog with both Radix dismissal paths explicitly suppressed, and a revoke confirmation cloned from `delete-tier-set.tsx` with the sole-live-credential escalation line.
- `components/app-shell/settings-nav.tsx`: adds the Senders entry to `SETTINGS_ITEMS`, nested under the existing Settings group.
- `lib/push/__tests__/senders.test.ts`: 24 tests covering both schemas, every pure function in `credentials.ts`, and — via the same `@/lib/supabase/server` mocking convention `lib/settings/__tests__/alignment-settings.test.ts` established — the real `issuePushCredential`/`revokePushCredential` Server Actions, including the shape guarantee that the complete token exists on exactly one return path in the module.

## Task Commits

Each task was committed atomically:

1. **Task 1: The contracts and the write path** - `43cbc44` (feat)
2. **Task 2: The page shell, the credential list and the sidebar entry** - `77f09f9` (feat)
3. **Task 3: Mint, reveal once, revoke** - `8993fa0` (feat)

A stale Task-2 doc comment (describing the mint-form region as still a placeholder after Task 3 had wired it in) was caught during self-review and corrected in a follow-up commit: `fa4185b` (docs).

**Plan metadata:** committed separately (this SUMMARY + STATE.md/ROADMAP.md/REQUIREMENTS.md update).

## Files Created/Modified

- `lib/push/schema.ts` - `mintCredentialSchema`/`revokeCredentialSchema`
- `lib/push/credentials.ts` - pure list-presentation rules, no DOM dependency
- `lib/push/__tests__/senders.test.ts` - schemas, pure functions, and the route-level shape guarantee (24 tests)
- `app/(dashboard)/settings/senders/actions.ts` - `issuePushCredential`/`revokePushCredential`
- `app/(dashboard)/settings/senders/page.tsx` - the `/settings/senders` route
- `components/settings/credentials-table.tsx` - one row per credential, sorted/badged/empty-stated via Task 1's pure functions
- `components/settings/mint-credential-form.tsx` - sender field + suggestion chips + reveal hand-off
- `components/settings/token-reveal-dialog.tsx` - the show-once surface, undismissable except by acknowledgment
- `components/settings/revoke-credential.tsx` - destructive confirmation with the sole-live-credential escalation
- `components/app-shell/settings-nav.tsx` - new `SETTINGS_ITEMS` entry

## Decisions Made

See `key-decisions` in the frontmatter above. The most consequential: `distinctSenders` deliberately includes senders whose only credentials are revoked (not just live ones), since the chip row's entire purpose — preventing an accidental near-duplicate sender identity — is served just as well by suggesting a name that once existed as one that's currently live.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stale placeholder doc comment left after Task 3 wired in the mint form**
- **Found during:** Self-review after Task 3's commit, before writing this SUMMARY
- **Issue:** `SendersBody`'s doc comment in `page.tsx` still described the mint-form region as "a placeholder in this task — Task 3 fills it with `MintCredentialForm`…", even though Task 3 had already replaced that placeholder with the real component. A stale comment describing code that no longer matches the code beneath it is a small but real correctness bug in the documentation.
- **Fix:** Rewrote the comment to describe the actual, final wiring (`MintCredentialForm` receiving the distinct senders, `RevokeCredential` receiving the sole-live flag).
- **Files modified:** `app/(dashboard)/settings/senders/page.tsx`
- **Verification:** `npx tsc --noEmit` clean; `npm run lint` 0 errors (baseline 18 warnings, unchanged).
- **Committed in:** `fa4185b`

---

**Total deviations:** 1 auto-fixed (1 bug — a doc-comment correction, no behavioural change).
**Impact on plan:** None on behaviour; corrects a documentation-only inaccuracy before it could mislead a future reader.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None yet — `push_credentials`/`push_credentials_audit` are written but not applied live (plan 09-05's task, performed by the orchestrator with Supabase MCP access this executor does not have). `/settings/senders` will render `ErrorState` until that migration is applied, which is the honest, correct behaviour for an as-yet-unmigrated table — not a bug in this plan's code.

## Next Phase Readiness

- The operator surface for AUTO-04 is complete and committed: mint, show-once reveal, and revoke, all through Zod-validated, session-scoped, audited Server Actions, with every list-presentation rule proved by unit test.
- Plan 09-05 must: apply migrations `0040_push_delivery_spine.sql` and `0041_push_rejections.sql` live, regenerate `types/db.ts` (retiring `lib/push/tables.ts`'s escape hatch this plan also depends on), and — as part of its own live end-to-end check — mint a real credential through `/settings/senders` and confirm the page renders correctly against the live schema. That live confirmation, plus the browser-only human-checks this plan's Task 2/3 named (page rhythm, badge neutrality, the reveal/copy/revoke flow), are the concrete items for the phase-level UAT consolidation this project's `workflow.human_verify_mode: end-of-phase` setting defers to.
- No blockers for 09-04 (uploads-history provenance surfacing) or 09-05 to proceed against this plan's committed interfaces.

---
*Phase: 09-automated-drop-off-push-credentials-drain*
*Completed: 2026-09-25*

## Self-Check: PASSED

- All 9 created files found on disk (`lib/push/schema.ts`, `lib/push/credentials.ts`, `lib/push/__tests__/senders.test.ts`, `app/(dashboard)/settings/senders/actions.ts`, `app/(dashboard)/settings/senders/page.tsx`, `components/settings/credentials-table.tsx`, `components/settings/mint-credential-form.tsx`, `components/settings/token-reveal-dialog.tsx`, `components/settings/revoke-credential.tsx`) plus this SUMMARY.md.
- All 4 commits (`43cbc44`, `77f09f9`, `8993fa0`, `fa4185b`) found in `git log`.
- All plan-level `<verification>` commands re-run and passing: `npm test -- lib/push/__tests__/senders.test.ts` (24/24), `npm test` (561/561, up from the 537 baseline at 09-02's close — no regression), `npm run lint` (0 errors / 18 warnings — same baseline as 09-02's close), `npx tsc --noEmit` (clean), the secret-key grep over `app/(dashboard)/settings/senders` (0 matches), and the dialog-dismissal grep over `token-reveal-dialog.tsx` (3 matches — both suppressions present, plus their doc-comment mention). `npm run build` also re-confirmed clean with `/settings/senders` registered as a route.
- `plan_head_before: 2f96e357e5f08478d898f2324d305a4ca8d9c3c0`, `commits: 4` (measured via `git rev-list --count`).
