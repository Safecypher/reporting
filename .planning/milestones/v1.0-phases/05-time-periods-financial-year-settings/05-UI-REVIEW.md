# Phase 5 — UI Review

**Audited:** 2026-09-10
**Baseline:** 05-UI-SPEC.md (approved design contract, strict extension of 01/03/04-UI-SPEC.md)
**Screenshots:** not captured — dev server at localhost:3000 returned an auth redirect (307); this is an authenticated internal tool and a code-only audit was performed instead. Findings below are corroborated by 05-UAT.md's live-browser test results (10 tests, 7 pass / 1 issue / 2 skipped), which substitute for direct visual capture on the interaction-critical paths.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Contract copy matches almost verbatim; two accepted-open warnings (WR-08, WR-09) leave under-disclosure and self-referential copy in the tier-editor dialogs |
| 2. Visuals | 4/4 | Scope badge/period row placement, mode statement, and warning-vs-destructive iconography all match the spec's visual-hierarchy table exactly |
| 3. Color | 4/4 | No hardcoded hex/rgb in any Phase 5 file; `--warning` vs `--destructive` split is correctly applied per the binding rule, including the historically-buggy collision-message re-tone |
| 4. Typography | 4/4 | Phase 5's own new elements use only Poppins 400/500 as contracted; existing 300-weight body text is pre-existing brand usage, not a new violation |
| 5. Spacing | 4/4 | `flex flex-wrap items-center gap-3` pattern reused verbatim from `ViewControls`; no arbitrary `[…px]` spacing found in touched files |
| 6. Experience Design | 3/4 | Mobile nav gap (G-05-OBS1) and the multi-round tier-editor supersede-disclosure defects (G-05-5, G-05-CR01) were real regressions caught only through UAT iteration, not first-pass correctness — now resolved, but the pattern of 3 successive rounds finding new defects on the same save path is itself a signal |

**Overall: 22/24**

---

## Top 3 Priority Fixes

1. **WR-08 — `resolveEditImpact`'s `supersedes` names only the immediately-crossed neighbour, not a further set whose territory is also ceded** (`lib/pricing/restate-scope.ts`) — user impact: with 3+ tier sets, a backdate can silently transfer pricing authority for a range the confirmation dialog never mentions, even though the day-count is accurate — concrete fix: extend `resolveEditImpact` to walk all sets whose range the edit crosses and list each one in the dialog body, not just the first.
2. **WR-09 — the edit-supersede dialog can produce self-referential "supersedes itself" copy when the proposed date lands exactly on another set's `effective_from`** (`lib/pricing/restate-scope.ts`, pinned by `restate-scope.test.ts:274-282`) — user impact: confusing copy is shown before the server's real duplicate-key rejection fires, undermining trust in the warning dialog right when it matters most — concrete fix: port the exact-date guard already applied to the create path (05-09) to the edit path, and update the pinned test to assert the corrected behavior rather than the bug.
3. **Tier-editor save-path needs one deliberate design pass, not further patch rounds** (per 05-UAT.md's own "Known Open" note — three code-review rounds each found a new defect on this same surface) — user impact: continuing to patch this surface incrementally risks a fourth undiscovered edge case in a component that can misstate (though not mis-price) revenue history — concrete fix: the follow-up already recorded in 05-UAT.md ("Tier-editor save-path design review — create/edit modes, supersede disclosure, collision handling") should be scheduled as its own phase/plan rather than deferred indefinitely.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)
- All contracted strings verified present and matching verbatim: `Showing {period.label}` (`components/dashboard/scope-badge.tsx:22`), `Save and restate revenue` / `Keep editing` (`components/pricing/pricing-tier-form.tsx:392`), `Delete this pricing tier set?` / `This cannot be undone.` (`components/pricing/delete-tier-set.tsx:60-64`), the FY scope-impact notice and `No changes yet — using the default financial year (1 January).` empty copy (`app/(dashboard)/settings/general/page.tsx:138`).
- The effective-from collision message ("A pricing tier set already exists for this date") — originally reported in UAT test 5 rendering in destructive red for what is a validation block, not a destructive act — is now correctly tone-routed via `bannerError.tone` (`pricing-tier-form.tsx:443-445`), resolving G-05-5's copy-tone half.
- Remaining defects are the two **accepted-open, non-blocking** items in 05-UAT.md's "Known Open" section: WR-08 (under-disclosure — the dialog names only the immediately-crossed set) and WR-09 (self-referential "supersedes itself" copy on exact-date collision in edit mode, unresolved sibling of the already-fixed WR-02 create-mode case). Per the UAT's own gate, these are not re-litigated as blockers here, but they are real copy-correctness gaps and are surfaced again as priority fixes above per this audit's adversarial mandate.

### Pillar 2: Visuals (4/4)
- Scope badge sits beside `FreshnessBadge` using the identical `Badge variant="outline"` + sprite-icon shape, exactly as specified (`scope-badge.tsx:16-24`).
- Period control row uses the contracted `flex flex-wrap items-center gap-3` and the FY/CY sub-toggle is genuinely unmounted (not `hidden`) for Month/All-time (`period-controls.tsx:158-175`), matching the D-08 binding rule precisely — verified structurally in code and confirmed behaviorally in UAT test 2 (pass, "no flash of stale selection state").
- Create-vs-edit mode statement in the pricing form is unmistakable and always-on (`pricing-tier-form.tsx:412-429`, `isCreatingNewSet` driving both the statement and the submit-button label), closing G-05-5's "mode is not visually distinct" root cause.
- Mobile nav gap (G-05-OBS1, an out-of-phase App Shell defect discovered during this phase's UAT) is resolved: `MobileNavBar` renders a `SidebarTrigger` at `<768px` (`components/app-shell/mobile-nav-bar.tsx`), matching the breakpoint used by `use-mobile.ts`.

### Pillar 3: Color (4/4)
- No hardcoded hex/rgb literals found in any Phase 5 touched file (`period-controls.tsx`, `scope-badge.tsx`, `pricing-tier-form.tsx`, `fy-settings-form.tsx`) — all color is via Tailwind semantic classes or `var(--warning)`/`var(--destructive)` CSS-variable references.
- The warning-vs-destructive split is correctly binding: the restate-confirmation dialog uses `--warning` only (icon/border), confirm button stays `--primary`/default (`pricing-tier-form.tsx:611-613` comment confirms "never `--destructive`"); the tier-set delete dialog correctly uses `variant="destructive"` throughout (`delete-tier-set.tsx:56,71`) since that action is a real deletion.
- Scope badge explicitly avoids `--primary` and semantic status colors, using `text-muted-foreground` only, per the "scope is a fact, not a judgment" rule.

### Pillar 4: Typography (4/4)
- Phase 5's new elements (`period-controls.tsx`, `scope-badge.tsx`, `fy-settings-form.tsx`, `settings/general/page.tsx`) use only `font-normal`/`font-medium`/`font-light` (mapping to Poppins 400/500, plus the pre-existing 300 body weight inherited from 01-UI-SPEC.md, not a new Phase 5 addition) — consistent with the contract's explicit carve-out.
- Font sizes observed (`text-xs`, `text-sm`, `text-lg`, `text-2xl`) are all within the established base scale; no arbitrary or out-of-scale sizes introduced.

### Pillar 5: Spacing (4/4)
- No arbitrary bracket-spacing values (`[.*px]`, `[.*rem]`) found in the audited Phase 5 files.
- The period-control row's `gap-3` and the settings page's `gap-2`/`gap-6` rhythm match the brand 4/8 scale and reuse `ViewControls`'/`PageHeader`'s existing pattern verbatim, as contracted.

### Pillar 6: Experience Design (3/4)
- All 9 UI-SPEC "UI Considerations" surfaces (E1–E9) are accounted for; state coverage (loading/error/empty/populated/period-empty) is implemented as specified — e.g., period-empty state correctly avoids the domain-empty state's "Upload report" CTA, and the 4-state contract plus the "5th value, not a 5th state" period-empty distinction is respected in code comments and structure.
- Loading/pending states use the disabled-button + pending-label convention consistently (`isPending` in `delete-tier-set.tsx`, restate dialog).
- Deduction: three separate rounds of code review/UAT (G-05-5, G-05-CR01, plus the still-open WR-08/WR-09) each found a *new* defect on the same tier-editor save/restate surface — a real trust-critical UX area (silent mispricing risk) that took multiple iterations to reach a merely "disclosure incomplete" rather than "actively wrong" state. The mobile-nav gap (G-05-OBS1) was also a first-pass miss, later fixed. This pattern — not any single remaining defect — is what keeps this pillar at 3 rather than 4; the two accepted-open copy gaps (WR-08/WR-09) are the concrete residue of it.
- UAT skipped items (audit-log cap and long-list Select overflow) are backstop-only and not reachable with current data volume — appropriately deferred, not a scoring deduction.

---

## Files Audited

- `components/dashboard/period-controls.tsx`
- `components/dashboard/scope-badge.tsx`
- `components/dashboard/view-controls.tsx`
- `components/pricing/pricing-tier-form.tsx`
- `components/pricing/delete-tier-set.tsx`
- `components/app-shell/mobile-nav-bar.tsx`
- `app/(dashboard)/settings/general/page.tsx`
- `app/(dashboard)/settings/pricing/actions.ts`
- `lib/pricing/restate-scope.ts` (referenced via UAT gap findings)
- `.planning/phases/05-time-periods-financial-year-settings/05-UI-SPEC.md`
- `.planning/phases/05-time-periods-financial-year-settings/05-UAT.md`
- `.planning/phases/05-time-periods-financial-year-settings/05-0{1..9}-SUMMARY.md`
