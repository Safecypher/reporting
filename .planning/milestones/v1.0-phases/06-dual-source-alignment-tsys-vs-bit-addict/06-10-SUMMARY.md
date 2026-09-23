---
phase: 06-dual-source-alignment-tsys-vs-bit-addict
plan: 10
subsystem: settings
tags: [nextjs, server-actions, postgres-trigger, vitest, alignment, settings-robustness]

requires:
  - phase: 06-dual-source-alignment-tsys-vs-bit-addict (06-01..06-09)
    provides: trg_app_settings_baseline_as_of (0033), fetchAlignmentSettings/AlignmentSettings, the three verdict-rendering surfaces (/alignment, /alignment/[metric], /), the /settings/general Dual-source alignment section
provides:
  - "saveAlignmentSettings no longer writes tsys_live_cards_baseline_as_of -- exactly one layer (the 0033 trigger) owns the column (closes WR-02/ALIGN-06)"
  - "AlignmentSettingsResult -- the discriminated {settings, error} result fetchAlignmentSettings now returns, distinguishing a genuine settings-read failure from a deliberately-configured zero (closes WR-03/ALIGN-06)"
  - "SettingsFallbackNotice -- the scoped, non-blocking, role=status notice wired into all three verdict-rendering surfaces plus /settings/general's own form"
  - "The completed, human-approved 06-UAT.md record for the whole of Phase 6, with one new app-wide icon-colour defect logged for separate follow-up"
affects: [any future plan touching public/icons.svg or Server Action write-path conventions]

actuals:
  tokens: 6000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "vitest.config.mts added with a minimal `@` alias (resolve.alias -> repo root) so Vitest can resolve the same `@/*` tsconfig path convention every source file already uses at runtime, not just in type-only imports -- the first test in this repo to unit-test a real Server Action needed it"
    - "Server Action unit-tested by mocking @/lib/supabase/server's createClient and next/cache's revalidatePath, then invoking the real exported action against a stubbed chainable query builder that captures its .update() payload"

key-files:
  created:
    - vitest.config.mts
    - lib/settings/__tests__/alignment-settings.test.ts
    - components/dashboard/settings-fallback-notice.tsx
  modified:
    - app/(dashboard)/settings/general/actions.ts
    - lib/settings/alignment-settings.ts
    - app/(dashboard)/alignment/page.tsx
    - app/(dashboard)/alignment/[metric]/page.tsx
    - app/(dashboard)/page.tsx
    - app/(dashboard)/settings/general/page.tsx
    - .planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-UAT.md

key-decisions:
  - "Added vitest.config.mts as a Rule 3 (blocking-issue) deviation: no test in this repo previously imported a module with a runtime (non-type-only) `@/` specifier, so Vitest could not resolve saveAlignmentSettings's own `@/lib/supabase/server` import. A minimal `resolve.alias` config (no new package) fixes this repo-wide; verified the full pre-existing suite (355/355) was unaffected before adding the plan's own tests on top of it."
  - "saveAlignmentSettings's JSDoc names the trigger and the atomicity rationale (a read-then-write cannot be made atomic against a concurrent save) without ever spelling out the literal string tsys_live_cards_baseline_as_of in prose, so the file's own acceptance-criteria grep (must report zero occurrences of that column name) and the plan's requirement to document the reasoning are both satisfied without contradiction."
  - "fetchAlignmentSettings's absent-row path keeps error: null (not a failure) -- only a genuine query error sets a non-null error string. This is the discriminating line the whole fix rests on: an app_settings row that was never saved is the documented default state (UI-SPEC E7), not a settings-read failure."
  - "SettingsFallbackNotice takes no props and decides nothing -- every call site gates it explicitly on its own `error !== null`, per the plan's own instruction that the calling pattern should read explicitly rather than have the component infer anything."
  - "06-UAT.md records the human's single overall approval verbatim rather than fabricating per-test observed values it was never given -- each of the eleven tests and four re-checks is marked approved-by-human-walkthrough with an explicit 'no per-test value reported' note, not `pass`. An honest, coarse-grained record was chosen over a fabricated fine-grained one."
  - "The icon-glyph colour defect found during the walkthrough is recorded as a new Gap in 06-UAT.md and a WINDOWS.md ledger entry (id 6), not fixed here -- it is app-wide, pre-existing, and out of 06-10's WR-02/WR-03 scope."

requirements-completed: [ALIGN-06]

coverage:
  - id: D1
    description: "saveAlignmentSettings's .update() payload contains exactly tsys_live_cards_baseline_offset, alignment_tolerance, updated_by and updated_at -- never tsys_live_cards_baseline_as_of -- with and without an offset change, proving the application no longer competes with the 0033 trigger for that column (closes WR-02/ALIGN-06)"
    requirement: "ALIGN-06"
    verification:
      - kind: unit
        ref: "lib/settings/__tests__/alignment-settings.test.ts#saveAlignmentSettings (2 cases: full save, tolerance-only-equivalent save)"
        status: pass
      - kind: other
        ref: "grep -c tsys_live_cards_baseline_as_of app/(dashboard)/settings/general/actions.ts -> 0; grep -c todayUtc -> 0; grep -cE 'alignmentSettingsSchema.safeParse|friendlyAlignmentSettingsErrorMessage|revalidatePath' -> 13 (>=8)"
        status: pass
    human_judgment: true
    rationale: "The trigger's actual runtime effect (that a caller-supplied value for this column is truly ignored, and that the as-of date moves only on a genuine offset change) requires a real database write and was already proven live in 06-09-TASK1-RECORD.md's baseline_as_of_trigger_test.sql oracle plus 06-08's live-schema catalog checks -- not re-provable from this plan's unit test alone, which only proves the application's payload shape. The human walkthrough's re-check D asked for a live before/after as-of comparison; per the coordinator's explicit instruction, no per-test observed value was reported for that re-check, so the live end-to-end behaviour is confirmed by the prior oracle evidence and the human's overall approval, not by a specific recorded date pair from this session."
  - id: D2
    description: "fetchAlignmentSettings returns AlignmentSettingsResult ({settings, error}); the absent-row path resolves error: null (the documented default, UI-SPEC E7) while a genuine query error resolves error: <message>, so the two are provably distinguishable rather than collapsing to the same DEFAULT_ALIGNMENT_SETTINGS shape (closes WR-03/ALIGN-06)"
    requirement: "ALIGN-06"
    verification:
      - kind: unit
        ref: "lib/settings/__tests__/alignment-settings.test.ts#fetchAlignmentSettings (4 cases: query error+logs, absent row, present row, never-throws across all three)"
        status: pass
    human_judgment: false
  - id: D3
    description: "SettingsFallbackNotice (role=status, muted tone, wraps rather than truncates) is rendered, gated explicitly on a non-null error, on all three verdict-rendering surfaces (/alignment above the still-fully-rendered four-card grid; / between the header and the strip, OUTSIDE every TileErrorBoundary; /alignment/[metric] above the day-breakdown table) plus /settings/general's own form -- never replacing the surface it sits on"
    requirement: "ALIGN-06"
    verification:
      - kind: other
        ref: "grep -rc SettingsFallbackNotice across the four call-site files -> 3,2,2,2 (all >=1); npx tsc --noEmit clean; npm run build -> 17 routes"
        status: pass
    human_judgment: true
    rationale: "Whether the notice is visually correct, sits in the right position relative to the grid/strip/form, and reads clearly was covered by the human walkthrough's tests 1-11 and re-check D, but (per the coordinator's explicit instruction to the executor) no per-test visual observation was reported back -- only an overall approval plus the unrelated icon-glyph finding. The component's gating logic and position in the render tree are proven by grep/tsc/build; its actual on-screen appearance rests on the human's overall approval, not a specific recorded observation."
  - id: D4
    description: "The full eleven-test 06-UAT.md record plus the four 06-10-specific re-checks (A-D) are completed with an honest observed-value record (no fabricated per-test data), and the phase's five ROADMAP success criteria have been walked through in a browser by a human"
    requirement: "ALIGN-06"
    verification:
      - kind: manual_procedural
        ref: "06-UAT.md (status: complete) -- human approved the full walkthrough with one new finding (icon-glyph colour, logged as a Gap and WINDOWS.md entry 6, not fixed in this plan)"
        status: pass
    human_judgment: true
    rationale: "This is inherently a human-judgment deliverable -- a browser walkthrough. Recorded here for completeness of the coverage block; the actual evidence lives in 06-UAT.md itself."

duration: ~13min executor-active (Tasks 1-2, 2026-09-11 17:33-17:44) + a multi-day human-verification gap before Task 3's approval (2026-09-14)
completed: 2026-09-14
status: complete
---

# Phase 6 Plan 10: Settings robustness (WR-02/WR-03) + completed human walkthrough Summary

**Closed the two tracked robustness findings from 06-REVIEW.md — the Server Action no longer writes `tsys_live_cards_baseline_as_of` (the 0033 trigger is now the column's sole owner) and a settings-read failure now surfaces a visible `SettingsFallbackNotice` instead of silently rendering assumed defaults — then got the first full human browser walkthrough of Phase 6, approved with one new (out-of-scope, app-wide) icon-colour finding logged for later.**

## Performance

- **Duration:** ~13 min of executor-active work across Tasks 1-2 (2026-09-11T17:33Z-17:44Z), then a multi-day pause at the Task 3 `checkpoint:human-verify` (`gate="blocking-human"`, never auto-approved) until the human's approval arrived 2026-09-14.
- **Tasks:** 3 (2 executor-performed + committed, 1 human-verified)
- **Files modified:** 9 (3 created, 6 modified) across Tasks 1-2, plus `06-UAT.md` for Task 3's record

## Accomplishments

- `app/(dashboard)/settings/general/actions.ts`: `saveAlignmentSettings`'s `.update()` payload no longer includes `tsys_live_cards_baseline_as_of` or the `todayUtc` local that computed it — the JSDoc is rewritten to name `trg_app_settings_baseline_as_of` (0033) as the column's sole owner and to explain, in prose, why a fetch-then-compare equivalent inside the action was rejected (not atomic against a concurrent save).
- `lib/settings/alignment-settings.ts`: `fetchAlignmentSettings` now returns the exported `AlignmentSettingsResult` (`{ settings, error: string | null }`) instead of the bare `AlignmentSettings`. All three exit paths (query error, absent row, present row) stay distinguishable; only the absent-row path keeps `error: null` (the documented UI-SPEC E7 default state).
- `components/dashboard/settings-fallback-notice.tsx` (new): `SettingsFallbackNotice`, a `role="status"`, muted-tone, wrapping (never truncating) presentational notice reusing the existing inline-notice Tailwind treatment. Renders unconditionally when mounted — every call site gates it explicitly on its own `error !== null`.
- Four call sites updated for the new discriminated result and to render the notice: `/alignment` (above the still-fully-rendered four-card grid), `/` (between the header and the alignment strip, OUTSIDE every `TileErrorBoundary` so a settings failure cannot blank the strip or any tile), `/alignment/[metric]` (above the day-breakdown table), and `/settings/general` (inside the Dual-source alignment section, above the form itself — the place a silent fallback would be most dangerous, since an admin could "confirm" values from a form they never actually saw).
- `lib/settings/__tests__/alignment-settings.test.ts` (new): 6 unit tests — 2 asserting `saveAlignmentSettings`'s captured `.update()` payload key set (with and without an offset change), and 4 covering `fetchAlignmentSettings`'s three discriminated states plus a never-throws assertion, all against a stubbed Supabase client.
- **Deviation:** added `vitest.config.mts` (a minimal `@` → repo-root `resolve.alias`, no new npm package) because this is the first test in the repo to unit-test a real Server Action, and `saveAlignmentSettings`'s own `@/lib/supabase/server` import could not be resolved by Vitest without it — every prior test in this repo used relative imports exclusively. Verified the full pre-existing suite (355/355) was unaffected before layering this plan's own 6 new tests on top (final count 361/361).
- **Task 3 (human walkthrough, `checkpoint:human-verify`, `gate="blocking-human"`):** approved. The dev server was started and confirmed responding before the checkpoint was returned to the coordinator. The human's entire verbatim response was: *"Approved. The only thing to note is that the glyphs are all black and not necessarily obvious."* No per-test observed value was given for any of the eleven `06-UAT.md` tests or the four 06-10-specific re-checks (A-D); `06-UAT.md` records each as `approved-by-human-walkthrough` with an explicit "no per-test value reported" note rather than inventing one — see "Known Gaps in the UAT Record" below.

## Task Commits

Each task was committed atomically:

1. **Task 1: The Server Action stops owning the as-of column (WR-02)** - `a052fc5` (fix)
2. **Task 2: A settings-read failure becomes visible instead of silently becoming zeroes (WR-03)** - `3ed20a9` (fix)
3. **Task 3: Human walkthrough** - human-verified, approved 2026-09-14; recorded in `06-UAT.md` and this SUMMARY (no separate task-3 code commit — the code under test was already committed in Tasks 1-2)

**Plan metadata:** (this commit)

## Files Created/Modified

- `app/(dashboard)/settings/general/actions.ts` - `saveAlignmentSettings` no longer writes `tsys_live_cards_baseline_as_of`; JSDoc rewritten
- `lib/settings/alignment-settings.ts` - `fetchAlignmentSettings` returns the new `AlignmentSettingsResult` discriminated type
- `components/dashboard/settings-fallback-notice.tsx` - New: `SettingsFallbackNotice`
- `app/(dashboard)/alignment/page.tsx` - Destructures the new result; renders the notice above the four-card grid
- `app/(dashboard)/alignment/[metric]/page.tsx` - Destructures the new result; renders the notice above the day-breakdown table
- `app/(dashboard)/page.tsx` - Destructures the new result; renders the notice outside every `TileErrorBoundary`
- `app/(dashboard)/settings/general/page.tsx` - Destructures the new result; renders the notice inside the Dual-source alignment section, above the form; comment at the fetch call site updated
- `lib/settings/__tests__/alignment-settings.test.ts` - New: 6 unit tests covering both Task 1 and Task 2
- `vitest.config.mts` - New: minimal `@` alias so Vitest resolves this repo's `@/*` tsconfig convention at runtime (deviation, see Decisions)
- `.planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-UAT.md` - Completed with the human's approval record, honestly noting the absence of per-test observed values, plus the new icon-glyph Gap

## Decisions Made

See `key-decisions` in frontmatter above.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `vitest.config.mts` to enable `@/*` alias resolution under Vitest**
- **Found during:** Task 1, while writing the test asserting `saveAlignmentSettings`'s captured update payload
- **Issue:** `saveAlignmentSettings` imports `createClient` from `@/lib/supabase/server` as a real runtime value import. No test in this repo had previously imported anything with a runtime (non-type-only) `@/` specifier — every existing test used relative imports, and every prior `@/` reference in a tested module was type-only (erased by TypeScript before Vitest ever saw it). Without alias resolution, `npx vitest run lib/settings/__tests__/alignment-settings.test.ts` failed immediately with `Cannot find package '@/lib/supabase/server'` — the task's own acceptance criterion (a unit test invoking the real Server Action) was unachievable.
- **Fix:** Added `vitest.config.mts` with `resolve: { alias: { "@": path.resolve(import.meta.dirname) } }` — no new npm package, using only the already-installed `vitest/config`. Named `.mts` (not `.ts`) to avoid Vite's CJS/ESM `configLoader` warning, and used `import.meta.dirname` (not `__dirname`) to avoid a second warning about that global under Vite's native config loader.
- **Files modified:** `vitest.config.mts` (new)
- **Verification:** Ran the full pre-existing suite (`npx vitest run`) both before (355/355 unaffected) and after (361/361, the 6 new tests) adding this config.
- **Committed in:** `a052fc5` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking).
**Impact on plan:** Necessary infrastructure to make the plan's own explicitly-required unit test achievable at all; no scope creep beyond enabling that one test file. Verified it does not alter behavior for any other test in the suite.

## Known Gaps in the UAT Record

The human approved the full Task 3 walkthrough (all eleven `06-UAT.md` tests plus the four
06-10-specific re-checks A-D) but reported only ONE overall response, with no per-test observed
values. Per explicit instruction, `06-UAT.md` records this honestly — each test/re-check is marked
`approved-by-human-walkthrough` with a note that no per-test value was given, rather than a
fabricated `pass` with an invented observation. This is a deliberate, disclosed gap in the record's
granularity, not a silent one: the underlying logic each test targets remains backed by its own
unit/oracle evidence (recorded across 06-07/06-08/06-09-SUMMARY.md and this plan's own test file),
and the walkthrough's role was end-to-end human confirmation on top of that, which was given.

## New Finding (out of scope for this plan — logged for follow-up)

**Icon sprite renders every glyph as solid black, ignoring status colour.** Reported verbatim by
the human during the Task 3 walkthrough: *"the glyphs are all black and not necessarily obvious."*

**Root cause** (diagnosed by the coordinator, not re-investigated here): `public/icons.svg`
contains zero `stroke=` attributes. Its symbols are stroke-style geometry (e.g. `alert` is
`M12 3 2 21h20L12 3Z`, a triangle *outline*; `check` is `circle r=9` plus a tick path). With no
`stroke`/`fill` set, SVG defaults to `fill: black; stroke: none` — so each outline fills solid
black and interior detail strokes (the `!` in `alert`, the tick in `check`) have no area and render
as nothing. Only 5 elements carry `fill="currentColor"` (intentional dots). Consequence: components
correctly apply `text-destructive`/`text-success`/`text-muted-foreground`, but those set `color`,
which only reaches an icon via `currentColor` — nothing in the sprite reads it, so status colour
never lands on the glyph itself.

**Scope:** app-wide and pre-existing (~20 usage sites across `app/(dashboard)/**`), **not**
introduced by Phase 6 or this plan. **Deliberately not fixed here** — 06-10's scope is WR-02/WR-03
only, and this touches a shared asset used across every phase.

**Significance, stated honestly:** this does not corrupt any figure or verdict — `StatusBadge`'s
text label (`Aligned` / `Needs review` / `Mismatch`) still carries the meaning correctly, and badge
background/border colour is unaffected. Only the *at-a-glance* icon-colour affordance (relevant to
ROADMAP SC5/ALIGN-05's "visible without opening the reconciliation page" framing) is weakened —
a viewer must read the text label rather than recognise colour at a glance from the icon alone.

**Recorded in:** `06-UAT.md` `## Gaps` (this session) and `.planning/WINDOWS.md` entry id 6
(`kind: lint-warning`, `status: open`). Recommended follow-up: add `stroke="currentColor"
fill="none"` (or equivalent) to the sprite's stroke-style symbols in a separate gap-closure or
quick task.

## Issues Encountered

None beyond the one documented deviation above. All acceptance criteria and `<verify>` commands
for Tasks 1 and 2 were run and passed:
- `npx vitest run lib/settings/__tests__/alignment-settings.test.ts` — 6/6 passed
- `npx vitest run` (full suite) — 361/361 (up from the 355 baseline recorded in 06-09-SUMMARY.md)
- `npx tsc --noEmit` — clean, re-run at the end of this plan (post-UAT-update) and confirmed clean again
- `npm run build` — 17 routes generated, no compile failures, re-run at the end of this plan and reconfirmed
- `npm run lint` — 0 errors, the same 13 pre-existing warnings unrelated to any file this plan touched
- `grep -c tsys_live_cards_baseline_as_of app/(dashboard)/settings/general/actions.ts` — 0
- `grep -rc SettingsFallbackNotice` across all four call-site files — all ≥1

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Phase 6 is now fully complete**: all 10 plans (06-01 through 06-10) have a `*-SUMMARY.md`, and `06-UAT.md` is `status: complete` with a human-approved full walkthrough.
- **One new, out-of-scope defect is open**: the icon-glyph colour issue (`public/icons.svg`, WINDOWS.md id 6). This does not block phase completion — it does not corrupt any figure — but should be picked up as a follow-up gap-closure or quick task before it's forgotten, since it affects every phase's iconography, not just Phase 6's.
- `REQUIREMENTS.md`'s `ALIGN-06` can be marked complete per this plan's `requirements` frontmatter.
- Recommend running `/gsd-verify-work 6` (or reviewing this SUMMARY + `06-UAT.md` directly) before moving on to Phase 7 (TSYS Tiered Volume & Revenue Forecast), given this is the first genuinely complete end-to-end human confirmation this phase has had.

---
*Phase: 06-dual-source-alignment-tsys-vs-bit-addict*
*Completed: 2026-09-14*

## Self-Check: PASSED

All key files confirmed present on disk: `app/(dashboard)/settings/general/actions.ts`,
`lib/settings/alignment-settings.ts`, `components/dashboard/settings-fallback-notice.tsx`,
`app/(dashboard)/alignment/page.tsx`, `app/(dashboard)/alignment/[metric]/page.tsx`,
`app/(dashboard)/page.tsx`, `app/(dashboard)/settings/general/page.tsx`,
`lib/settings/__tests__/alignment-settings.test.ts`, `vitest.config.mts`,
`.planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-UAT.md`. Both task commit hashes
(`a052fc5`, `3ed20a9`) confirmed present via `git log --oneline --all`. `npx tsc --noEmit`,
`npx vitest run` (361/361) and `npm run build` (17 routes) re-confirmed green on the final
committed state before this SUMMARY was written.
