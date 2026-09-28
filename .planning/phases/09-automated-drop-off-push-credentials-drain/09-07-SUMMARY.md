---
phase: 09-automated-drop-off-push-credentials-drain
plan: 07
subsystem: settings
tags: [supabase, next.js, identity]

# Dependency graph
requires:
  - phase: 09-automated-drop-off-push-credentials-drain
    provides: "lib/identity/profiles.ts (fetchActorEmails/actorLabel/UNKNOWN_ACTOR_LABEL) and the live profiles table plan 09-06 built"
provides:
  - "G-09-1's second named surface closed: /settings/pricing no longer renders a raw auth.users uuid as the change-history actor"
  - "/settings/general and /settings/senders also migrated off their byte-identical changed_by ?? \"Unknown user\" defect — a deliberate, confirmed expansion beyond the one file G-09-1 names"
  - "all three settings change-history lists now resolve their actor through the single lib/identity/profiles.ts rule; the unresolved-actor wording exists in exactly one place in the codebase"
affects: [settings-pricing, settings-general, settings-senders]

# Actuals (#2632)
actuals:
  tokens: 1599
  tasks: 2
  commits: 2
  plan_head_before: 49637d4

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "server-component actor-id resolution: fetchActorEmails(supabase, rows.map(r => r.changed_by)) run as an extra round trip AFTER the primary Promise.all resolves (ids aren't known until then), with its error kept out of the page's combined ErrorState branch — same shape as /uploads (09-06)"

key-files:
  created: []
  modified:
    - "app/(dashboard)/settings/pricing/page.tsx"
    - "app/(dashboard)/settings/general/page.tsx"
    - "app/(dashboard)/settings/senders/page.tsx"

key-decisions:
  - "Task 2 was executed, not dropped. Mark was asked explicitly before this dispatch and chose to keep both tasks: /settings/general and /settings/senders carry byte-identical code and the identical raw-actor defect to /settings/pricing, and the resolver already exists — a half-fixed set of three would read as a bug, not a documented gap. This is deliberate expansion beyond the single file G-09-1 names, recorded here rather than left to be re-derived from the diff."

patterns-established:
  - "Identity-read failures on a settings page are logged and degrade the actor label only — never joined into the page's combined ErrorState branch. Kept strictly separate from the louder SettingsFallbackNotice contract (WR-03/T-07-10) that already exists on /settings/general for a different class of failure (a form pre-filled from a failed settings read)."

requirements-completed: [AUTO-06]

coverage:
  - id: D1
    description: "/settings/pricing's change history resolves each row's actor through actorLabel/fetchActorEmails; the raw changed_by ?? uuid fallback is gone"
    requirement: AUTO-06
    verification:
      - kind: other
        ref: "grep -c 'actorLabel' app/(dashboard)/settings/pricing/page.tsx (=2); grep -v changed_by ?? app/(dashboard)/settings/pricing/page.tsx (=0)"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit"
        status: pass
      - kind: other
        ref: "npm run lint (0 errors, 18 warnings baseline)"
        status: pass
    human_judgment: true
    rationale: "The plan's own <human-check> requires opening /settings/pricing on the deployed dashboard and visually confirming every change-history row begins with an email, not a uuid, and that the rest of the page (tier form, at-cap notice) is unchanged. Not executed in this offline session."
  - id: D2
    description: "/settings/general and /settings/senders route their own change-history actor through the identical rule; no file under app/(dashboard)/settings still coalesces changed_by to a literal fallback string, and the unresolved-actor wording exists in exactly one place"
    requirement: AUTO-06
    verification:
      - kind: other
        ref: "grep -rn '\"Unknown user\"' app/(dashboard)/settings (=0); grep -rv changed_by ?? app/(dashboard)/settings (=0)"
        status: pass
      - kind: other
        ref: "npm test (599/599, 38 files)"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit"
        status: pass
      - kind: other
        ref: "npm run lint (0 errors, 18 warnings baseline)"
        status: pass
    human_judgment: true
    rationale: "The plan's own <human-check> requires opening /settings/general and /settings/senders live and confirming both change-history lists name a person, and that /settings/general's financial-year form and dual-source alignment fallback-notice section are undisturbed. Not executed in this offline session."

duration: 12min
completed: 2026-09-28
status: complete
---

# Phase 9 Plan 7: Settings Actor-Email Resolution Summary

**All three settings change-history lists (/settings/pricing, /settings/general, /settings/senders) resolve their audit actor through `lib/identity/profiles.ts`'s `actorLabel`/`fetchActorEmails`, closing the raw-uuid render G-09-1 named at `/settings/pricing:132` and removing the byte-identical defect from the other two surfaces by explicit, confirmed choice.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-09-28T15:51:00Z
- **Completed:** 2026-09-28T16:03:29Z
- **Tasks:** 2 (both `type="auto"`)
- **Files modified:** 3

## Accomplishments

- `/settings/pricing`'s `pricing_tier_audit` rows now resolve `changed_by` through `fetchActorEmails`/`actorLabel` instead of `row.changed_by ?? "Unknown user"` — the second surface G-09-1's `chosen_approach` named explicitly.
- `/settings/general`'s `app_settings_audit` rows and `/settings/senders`' `push_credentials_audit` rows migrated to the identical rule — a deliberate, Mark-confirmed expansion beyond the one file G-09-1 names, done because both carried the byte-identical defect and the resolver already existed.
- Each page's identity-read error is logged and kept out of that page's combined `ErrorState` branch — a lost email degrades one column, never the whole page. On `/settings/general` this is explicitly documented as a separate, quieter contract from the existing `SettingsFallbackNotice` (WR-03/T-07-10), which concerns a different failure class (a form pre-filled from a failed settings read).
- `/settings/pricing`'s stale `PricingBody` doc comment — which asserted no email-resolving mechanism existed and that the raw id was an accepted gap — corrected; `/settings/general` and `/settings/senders` carried no equivalent doc-comment claim, so nothing to correct there.
- `components/pricing/audit-log.tsx` (the shared presentational component) and `package.json`/`package-lock.json` are untouched, confirmed by `git diff --stat`.

## Task Commits

Each task was committed atomically:

1. **Task 1: /settings/pricing names the person, not the uuid** - `4f44bac` (fix)
2. **Task 2: The same one rule on /settings/general and /settings/senders** - `b8a14d2` (fix)

## Files Created/Modified

- `app/(dashboard)/settings/pricing/page.tsx` - `fetchActorEmails`/`actorLabel` wired into `PricingBody`, stale doc comment corrected
- `app/(dashboard)/settings/general/page.tsx` - `fetchActorEmails`/`actorLabel` wired into `GeneralBody`, kept separate from the existing alignment/revenue-forecast fallback-notice contract
- `app/(dashboard)/settings/senders/page.tsx` - `fetchActorEmails`/`actorLabel` wired into `SendersBody`

## Decisions Made

- **Task 2 executed, not dropped.** The plan's Task 2 text is conditional ("If the orchestrator has been told to keep this plan to the named surface only, drop this task"). Mark was asked explicitly before this dispatch and chose to keep both tasks — recorded here per the plan's own `<output>` instruction so a reader six months from now does not have to re-derive which happened from the diff.

## Deviations from Plan

None - plan executed exactly as written, including the explicitly confirmed Task 2 expansion (not a deviation — the plan itself names this as an in-scope, orchestrator-decided choice).

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. This plan is presentation-only: no migration, no schema change, no trigger change.

## Next Phase Readiness

- G-09-1 is closed at the code level for all three change-history surfaces (`grep -rn 'changed_by ?? '` across `app/(dashboard)/settings` returns zero matches; `grep -rn '"Unknown user"'` likewise). `npm test` 599/599, `tsc` clean, `lint` 0 errors/18 warnings (the 09-06-established baseline).
- **Outstanding:** both tasks' `<human-check>` — opening the three pages on the deployed dashboard and visually confirming email addresses render instead of uuids, and that `/settings/general`'s FY form and dual-source alignment section are undisturbed — was not executed in this offline, non-interactive session. Route through the phase's next UAT pass, matching 09-06's own deferred `<human-check>` for the `/uploads` surface.
- No further known surfaces carry this defect: the three `*_audit.changed_by` columns and `ingested_files.uploaded_by` (09-06) are now all routed through `lib/identity/profiles.ts`.

## Self-Check: PASSED

Both key files confirmed modified on disk and both task commit hashes (`4f44bac`, `b8a14d2`) confirmed present via `git log --oneline`. Plan-level `<verification>` re-run: `npm test` 599/599 (38 files), `npx tsc --noEmit` clean, `npm run lint` 0 errors/18 warnings, `git diff --stat -- components/pricing/audit-log.tsx package.json package-lock.json` empty, `grep -rn 'changed_by ?? ' app/(dashboard)` zero matches.

---
*Phase: 09-automated-drop-off-push-credentials-drain*
*Completed: 2026-09-28*
