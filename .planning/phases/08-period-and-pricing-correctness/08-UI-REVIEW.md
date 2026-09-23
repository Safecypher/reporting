# Phase 08 — UI Review

**Audited:** 2026-09-23
**Baseline:** abstract 6-pillar standards (no UI-SPEC.md for this phase; 05-UI-SPEC.md's Copywriting Contract inherited by reference for the restate dialog)
**Screenshots:** not captured — dev server (localhost:3000) responds (307, auth redirect) but Playwright browsers are not installed locally, and the pricing editor sits behind Supabase auth, so a raw screenshot would only show the login page. Audit is code-only.

**Scope note applied:** this is a correctness/gap-closure phase, not a net-new UI build. Weighting follows the objective: Copywriting and Experience Design are primary; Visuals/Color/Typography/Spacing are secondary since no new visual design was introduced. A human completed UAT on the dialog/hint copy across all three variant shapes and confirmed it reads naturally — that observation stands; this audit does not re-litigate wording quality but does check structural/interaction risk the UAT pass wasn't scoped to catch.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Dialog/hint copy is strong and UAT-confirmed, but the generic save-error fallback string is duplicated in two places and one destructive-adjacent CTA label ("Add tier set and restate revenue") is dense for a warning-toned confirm |
| 2. Visuals | 3/4 | Clear single-column focal flow; icon in restate dialog is `aria-hidden` with no redundant text label pattern check, but header sentence already carries the meaning so it's low-risk |
| 3. Color | 3/4 | Warning/destructive/primary token usage is deliberate and documented, but hardcoded `--cypher-blue`/`--warning` var references bypass the `bg-primary`/`text-primary` utility class convention used elsewhere in the app |
| 4. Typography | 3/4 | 8 distinct text-size utilities and 3 weights in one form exceeds the ">4 sizes / >2 weights" abstract flag, though most are legitimate hierarchy (label vs. helper vs. error vs. mono numerals) |
| 5. Spacing | 4/4 | Spacing scale (gap-1.5/3/6, p-2/3/6) is consistent and matches Tailwind's default scale throughout the audited files — no arbitrary values found |
| 6. Experience Design | 3/4 | Correctly blocks/confirms all three restate shapes and never silently no-ops, but the confirm dialog has no keyboard-focus or double-submit guard beyond `isRestateSavePending`, and the inline preview/dialog duplication is a coupling risk if one is edited without the other |

**Overall: 19/24**

---

## Top 3 Priority Fixes

1. **Duplicated generic-error strings across two files** (`pricing-tier-form.tsx:282` and `lib/pricing/schema.ts:81`, plus a near-duplicate in `lib/pricing/errors.ts:56`) — user impact: if one copy is updated during a future fix (e.g. wording tweak) and the other isn't, the pre-submit and post-submit tier-validation errors will diverge, exactly the kind of two-different-stories bug this phase worked hard to eliminate for the restate dialog. Fix: import the single string from `lib/pricing/errors.ts` in both call sites instead of re-typing it in `pricing-tier-form.tsx:282`.

2. **No test/assertion pins the pre-submit inline preview against the dialog copy** — the code comments (`pricing-tier-form.tsx:232-243`) assert "the pre-submit hint can never disagree with what actually blocks the write" because both read `resolvePricingAuthorityMove`, but the *rendered sentences* for the inline preview (lines 486-513) are still hand-written JSX, separate from `buildRestateDialogCopy`'s sentence composition (restate-gate.ts:157-193). A future wording edit to one and not the other silently reintroduces the exact two-stories bug WR-08 fixed. Fix: route the inline preview's edit-supersede sentence through `buildRestateDialogCopy` (or a shared sentence-builder) rather than maintaining a second hand-written JSX rendering of the same logic.

3. **Confirm-button label density in `create-supersede` variant** — "Add tier set and restate revenue" (restate-gate.ts:153) packs two actions into one CTA under time pressure (a financial-authority-transfer confirmation). User impact: on a quick read, an operator confirming a supersede might register only "Add tier set" and miss "and restate revenue." Fix: consider a two-line button or moving "restate revenue" into the dialog body's closing sentence only, keeping the CTA to the single verb "Add tier set" — not blocking, but worth revisiting since this is the highest-stakes click in the phase.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)
- Restate dialog copy (`restate-gate.ts:142-201`) is well-structured: three variants, correct pluralization (`dayWord`), consistent closing sentence ("This is recorded in the change history"), and UAT-confirmed to read naturally in all three shapes per objective note — treated as a pass.
- Duplicate-date hint (`PRICING_DUPLICATE_EFFECTIVE_FROM`, referenced at `pricing-tier-form.tsx:324,481`) correctly reuses server copy so pre/post-submit never disagree — good pattern, exactly what's missing for the supersede preview (see Fix #2).
- Generic fallback string duplicated verbatim in two files (`pricing-tier-form.tsx:282`, `lib/pricing/schema.ts:81`) instead of importing from `lib/pricing/errors.ts` where a near-identical third variant already lives (`errors.ts:56`) — three near-identical strings, no single source of truth.
- `status-badge.tsx:35` defaults to bare `"OK"` — generic per the grep flag, but this is outside phase 08's scope (pre-existing, not touched by 08-01..08-05) and is not penalized here.

### Pillar 2: Visuals (3/4)
- Single-column vertical flow (mode statement → banner → effective-from/reset-window grid → tiers → submit) gives one clear focal point per step; no competing calls to action.
- Warning icon in the restate dialog (`pricing-tier-form.tsx:654-659`) is `aria-hidden`, relying on the adjacent `DialogTitle`/`DialogDescription` text to carry all meaning for screen readers — correct pattern, no orphaned icon-only signal.
- Inline supersede notice and duplicate-date hint occupy the same slot with an if/else (lines 476-516), so only one can show at a time — good, avoids stacked/competing warnings.
- Minor: the restate dialog's icon+title+body block (lines 652-665) has no visual distinction between the two "-supersede" variants and the plain "edit" variant beyond text — all three share the same icon/border treatment despite genuinely different stakes (single-set restate vs. permanent authority transfer). Not a blocker given the scope note, but worth flagging since the highest-stakes variant looks identical to the lowest-stakes one.

### Pillar 3: Color (3/4)
- Deliberate, documented color choices: confirm button stays `--cypher-blue` (primary) even in the warning dialog per the code comment at line 642-644 ("a legitimate save... never `--destructive`"), destructive reserved for the actual delete action (`delete-tier-set.tsx:57`). This is a genuinely good, intentional distinction — not overuse.
- However, `--cypher-blue`/`--warning`/`--warning-border` are referenced via raw `var()` in `className` (e.g. `bg-[var(--cypher-blue)]`, `pricing-tier-form.tsx:620,679,651`) rather than through semantic Tailwind utility classes (`bg-primary`, `border-warning`) the way `bannerError` styling does two lines later (`border-[color:var(--warning)]/30`, line 451). Two different syntaxes for referencing the same token family in one file is an inconsistency, not a violation — but it means a future dark-mode or token-rename pass has to catch both spellings.
- No hardcoded hex/rgb literals found in the audited files — all color references route through CSS custom properties.

### Pillar 4: Typography (3/4)
- `pricing-tier-form.tsx` uses 8 distinct `text-*` size/color-adjacent utilities and `text-sm`/`text-xs` for actual sizing (2 real sizes), plus `font-light`/`font-medium`/`font-mono` (3 weights) — exceeds the abstract ">4 sizes / >2 weights" flag on weight count specifically.
- On inspection, the weight variety is legitimate hierarchy: `font-medium` for labels/mode-statement, `font-light` for helper/secondary text, `font-mono tabular-nums` for numeric tier inputs (a defensible, common financial-UI convention for aligning digits). Scored 3 rather than 2 because the variety serves a real hierarchy purpose rather than being accidental drift, but it still exceeds the abstract threshold and should be noted if a future UI-SPEC formalizes the type scale for this app.

### Pillar 5: Spacing (4/4)
- Spacing values throughout (`gap-1.5`, `gap-3`, `gap-6`, `p-2`, `p-3`, `p-6`, `pb-1.5`) are all on Tailwind's default scale — no arbitrary bracketed spacing values (`grep` for `\[.*px\]|\[.*rem\]` returned no spacing hits in the audited files, only the pre-existing color `var()` usages).
- Consistent nesting rhythm: outer sections at `gap-6`/`p-6`, field groups at `gap-3`/`gap-1.5` — a legible, consistent scale step-down. No fixes needed.

### Pillar 6: Experience Design (3/4)
- Correctly handles the corrected defect: `resolveRestateGate` reads both `supersedes` and `futureSupersededBy` limbs (restate-gate.ts:97-117), closing the WR-08 silent-transfer gap. Confirmed by the module's own detailed trace comment and prior verification reports (per required reading) — not re-derived here, taken as a passing structural fact.
- Loading/pending state present and disables both dialog buttons during the async save (`isRestateSavePending`, lines 670,677,681) — prevents double-submit on the confirm path specifically.
- Cancel path ("Keep editing") correctly preserves form state rather than discarding it (line 375-379) — good, no silent data loss.
- Gap: outside the restate dialog's own transition guard, the main form's submit button only disables on `form.formState.isSubmitting` (line 619) — there's no equivalent guard against a user re-opening the tier-set selector or double-clicking during the `countRestatedDays` async call between submit and dialog-open (lines 298-372), a window where the button isn't shown disabled. Low risk (server-side unique constraint and RLS are the real backstop per this project's stated architecture) but worth a follow-up disabled state for a fully complete state-coverage story.
- Delete flow requires two-step confirmation (`DeleteTierSet`, delete-tier-set.tsx:57-66) — correct pattern for a destructive action, not one-click.

---

## Registry Safety

`components.json` not found in the project root — shadcn is not registry-tracked in a way this audit tool detects, so the registry safety audit is skipped per its own gating condition.

---

## Files Audited

- `/Users/markwright/Development/Clients/Safecypher/reporting/components/pricing/pricing-tier-form.tsx`
- `/Users/markwright/Development/Clients/Safecypher/reporting/lib/pricing/restate-gate.ts`
- `/Users/markwright/Development/Clients/Safecypher/reporting/components/pricing/delete-tier-set.tsx`
- `/Users/markwright/Development/Clients/Safecypher/reporting/components/dashboard/period-controls.tsx`
- `/Users/markwright/Development/Clients/Safecypher/reporting/lib/pricing/errors.ts` (grepped)
- `/Users/markwright/Development/Clients/Safecypher/reporting/lib/pricing/schema.ts` (grepped)
- `/Users/markwright/Development/Clients/Safecypher/reporting/components/dashboard/status-badge.tsx` (grepped, out of scope)
- Phase 08 SUMMARY.md (08-01 through 08-05) and PLAN.md (08-01 through 08-05) — required reading, context only
