---
phase: quick-260923-max
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - components/app-shell/settings-nav.tsx
  - components/app-shell/sidebar-nav.tsx
  - app/(dashboard)/layout.tsx
autonomous: true
requirements: ["quick-260923-max"]

estimate:
  tokens: 30000
  raw_tokens: 60000
  tasks: 2
  confidence: high

must_haves:
  truths:
    - "The main sidebar list shows eight entries and no settings entry (D-05); Home, Uploads, Verifications, Cards, Revenue, SLA, Reconciliation and Alignment are unchanged."
    - "A single 'Settings' row with a cog icon sits in the sidebar footer directly above Sign out (D-01, D-04)."
    - "On a non-settings route the group is collapsed and its direction affordance points right (D-01)."
    - "Activating the row reveals 'General' and 'Pricing' as indented sub-items linking to /settings/general and /settings/pricing (D-02)."
    - "Landing directly on a settings route renders the group already expanded with the current page marked active (D-03, D-06)."
    - "The trigger is a real button, reachable and operable by keyboard, with the accessible name 'Settings' and an aria-expanded that flips with state (D-01)."
    - "The same group renders and behaves identically inside the mobile Sheet below 768px (D-08)."
  artifacts:
    - components/app-shell/settings-nav.tsx
    - components/app-shell/sidebar-nav.tsx
    - app/(dashboard)/layout.tsx
  key_links:
    - "SidebarFooter -> SettingsNav rendered between the existing Separator and SignOutButton (D-04)"
    - "Collapsible.Trigger asChild -> SidebarMenuButton, so Radix's aria-expanded / aria-controls / data-state land on a real <button> (D-01)"
    - "usePathname -> inSettings -> Collapsible.Root defaultOpen + key, the auto-expand mechanism (D-03)"
    - "SidebarMenuSubButton isActive -> --sidebar-accent / --sidebar-accent-foreground, the same tokens SidebarMenuButton's active state reads (D-06)"
---

<objective>
Move the two settings pages out of the flat main sidebar list into a collapsible
"Settings" group pinned in the sidebar footer, directly above Sign out.

Purpose: `/settings/general` and `/settings/pricing` are configuration surfaces,
not reporting surfaces. Sitting mid-list between SLA and Reconciliation they read
as peers of Revenue and SLA, which they are not.

Output: a new client component `components/app-shell/settings-nav.tsx`, two
entries removed from `NAV_ITEMS`, and one line added to the dashboard layout's
`<SidebarFooter>`.
</objective>

<execution_context>
@~/.claude/gsd-core/workflows/execute-plan.md
@~/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@components/app-shell/sidebar-nav.tsx
@app/(dashboard)/layout.tsx
@components/ui/sidebar.tsx
</context>

<locked_decisions>
These are the user's decisions. They are not open for revisiting.

| ID | Decision |
|----|----------|
| D-01 | One "Settings" row, cog icon, collapsed by default, carrying a rotation/direction affordance for its open/closed state. |
| D-02 | Activating it expands to reveal "General" and "Pricing" as sub-items beneath it. |
| D-03 | Auto-expanded when the current route is already under `/settings/` — a user on the pricing page must not have their own location hidden inside a collapsed group. |
| D-04 | It lives in the sidebar **footer**, above `SignOutButton`, NOT in `SidebarContent`. |
| D-05 | `/settings/general` and `/settings/pricing` are removed from the main `NAV_ITEMS` list. |
| D-06 | Active-state styling for the sub-items matches how the rest of the nav indicates the current page. |
| D-07 | No new npm dependency. `radix-ui` is already a direct dependency; a plain `useState` implementation is acceptable only if it carries the same keyboard operability and ARIA. |
| D-08 | The same `<Sidebar>` renders as a `Sheet` below 768px, so the footer group must work on mobile too. |
</locked_decisions>

<facts_established_at_planning_time>
Measured live in this repo on 2026-09-23. Do not re-derive these; spend the
context on the implementation instead.

**Baselines to compare against (all green before this plan starts):**

| Check | Command | Baseline |
|-------|---------|----------|
| Typecheck | `npx tsc --noEmit` | clean — zero diagnostics, no output |
| Lint | `npm run lint` | `✖ 13 problems (0 errors, 13 warnings)` |
| Tests | `npm test` | `Test Files 33 passed (33)` / `Tests 494 passed (494)` |
| Build | `npm run build` | succeeds; route table lists 17 routes including `ƒ /settings/general` and `ƒ /settings/pricing` |

Known benign side effect, observed while measuring the above: `npm run build`
rewrites the generated `next-env.d.ts`, flipping its two imports from
`./.next/dev/types/...` to `./.next/types/...`. The tree was restored with
`git checkout -- next-env.d.ts` and typecheck re-confirmed clean afterwards, so
this plan starts from a clean tree. **Do not commit that file** — if it shows up
modified after a build, restore it the same way. It is not part of this change.

**Dependencies:**
- `radix-ui@^1.6.7` is a **direct** dependency (package.json). `@radix-ui/react-collapsible@1.1.20` resolves in `node_modules` but is **transitive only** — importing it by its own package name would be a phantom dependency. Import from the umbrella.
- `require('radix-ui').Collapsible` exposes `Root`, `Trigger`, `Content` (plus `Collapsible`/`CollapsibleTrigger`/`CollapsibleContent` aliases). Verified by direct module inspection.
- Repo convention for this import shape, already used in 12 files: `import { Tabs as TabsPrimitive } from "radix-ui"` (components/ui/tabs.tsx), `import { Slot } from "radix-ui"` (components/ui/sidebar.tsx).
- There is **no** `components/ui/collapsible.tsx` in this repo, and this plan does not add one — a single consumer does not justify a wrapper.

**Sidebar primitives (components/ui/sidebar.tsx):**
- `SidebarMenu` renders `<ul>`; `SidebarMenuItem` renders `<li class="group/menu-item relative">` and spreads props; `SidebarMenuSub` renders `<ul>`; `SidebarMenuSubItem` renders `<li>`; `SidebarMenuSubButton` renders `<a>` (or Slot when `asChild`).
- `SidebarMenuButton` renders a real `<button>` when `asChild` is false, and spreads all props onto it.
- `SidebarMenuSubButton` active styling is `data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground`; `SidebarMenuButton` active styling is `data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-accent-foreground`. Both read `--sidebar-accent` / `--sidebar-accent-foreground`, which `app/globals.css` maps to `--blue-tint-08` / `--cypher-blue`. D-06 is therefore satisfied by construction as long as `isActive` is passed.
- `SidebarFooter` is `<div class="flex flex-col gap-2 p-2">`; the layout overrides padding with `px-2 py-2`. It currently holds `<Separator className="mb-2" />` then `<SignOutButton />`.
- `<Sidebar>` defaults to `collapsible="offcanvas"`, so `SidebarMenuSub`'s `group-data-[collapsible=icon]:hidden` never fires here.

**Icon sprite (public/icons.svg):**
- There is **no chevron symbol**. `arrow-right` exists at line 126 and already carries `fill="none" stroke="currentColor" stroke-width="2"` with round cap/join **on the symbol itself** (quick task 260914-ot4).
- Per D-01's affordance requirement the decision is: **rotate `arrow-right` 90° via a CSS transform. Do NOT add a new symbol to the sprite.** A new symbol is avoidable risk — an external `<use>` inherits from the referencing document, not the sprite's ancestors, so a symbol missing those stroke attributes renders as a solid black blob.

**Test harness:**
- `vitest.config.mts` sets only the `@` alias. There is **no jsdom, no setup file, no React Testing Library**. Vitest here covers pure logic only.
- **Do not create a DOM/component test harness for this task.** The only new logic is a one-line `pathname.startsWith` predicate; extracting it to `lib/` to unit-test it would add indirection without catching any plausible bug. Verification for this plan is: typecheck + lint + build + structural greps + the manual UAT script in Task 2.
</facts_established_at_planning_time>

<tasks>

<task type="tracer" tdd="false">
  <name>Task 1: Collapsible Settings group in the sidebar footer, end to end</name>
  <files>components/app-shell/settings-nav.tsx, components/app-shell/sidebar-nav.tsx, app/(dashboard)/layout.tsx</files>
  <read_first>
components/app-shell/sidebar-nav.tsx (the flat NAV_ITEMS list, the UI-SPEC E8 exact-match branch for "/", and the svg `<use href={`/icons.svg#...`} />` shape)
app/(dashboard)/layout.tsx (the SidebarFooter block)
components/ui/sidebar.tsx lines 446-466 and 621-676 (SidebarMenu, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton)
  </read_first>
  <action>
Create `components/app-shell/settings-nav.tsx` as a `"use client"` component exporting `SettingsNav`, then wire it in and remove the two displaced entries. One vertical slice — after this task a user reaches both configuration pages only through the new group, and through nothing else.

**The new component.**

Import `{ Collapsible } from "radix-ui"` — the umbrella package, matching the repo convention in components/ui/tabs.tsx and components/ui/sheet.tsx. Do NOT import `@radix-ui/react-collapsible` by name (phantom dependency, D-07) and do NOT add anything to package.json. If `Collapsible.Root` / `Collapsible.Trigger` / `Collapsible.Content` do not resolve against the installed version, fall back to a `useState` implementation that keeps every ARIA guarantee below — an explicit `aria-expanded`, an `aria-controls` pointing at the content element's id (generate it with React's `useId`), and a real `<button>` trigger — and say so in the SUMMARY. Do not silently drop the ARIA wiring.

Declare a module-level `SETTINGS_ITEMS` array of two entries, mirroring the shape and ordering discipline of `NAV_ITEMS`: General linking to the general settings route, then Pricing linking to the pricing settings route. Labels are exactly "General" and "Pricing" — sentence case, no exclamation marks, per the project copywriting contract.

Read `usePathname()` and derive one predicate: whether the current path is inside the settings section (a `startsWith` check against the `/settings` prefix, null-safe with `?? false` exactly as the existing nav does).

Structure, outside-in:
- `<SidebarMenu>` (the `<ul>`) wrapping exactly one item.
- `<Collapsible.Root asChild defaultOpen={inSettings} key={inSettings ? "in-settings" : "outside"} className="group/collapsible">` with `<SidebarMenuItem>` as its single child, so the Root renders AS the `<li>` and no `<div>` is ever placed inside a `<ul>`. Per D-03, the `key` is the auto-expand mechanism: crossing into or out of the settings section remounts the group so `defaultOpen` is re-read, which means a direct URL load, a browser back/forward, and an in-app navigation all land expanded, while navigating between two non-settings pages preserves whatever the user did by hand. Write a short comment saying this, because a future reader will otherwise "clean up" the key and silently break D-03. Do not replace this with a `useEffect` that syncs state after render.
- `<Collapsible.Trigger asChild>` wrapping `<SidebarMenuButton>` — with NO `asChild` on `SidebarMenuButton` itself, so it renders a real `<button>` and Radix's `type="button"`, `aria-expanded`, `aria-controls` and `data-state` land on it. This is the D-01 accessibility guarantee; the trigger must never become an anchor.
- Inside the button: the cog glyph as `<svg aria-hidden="true" className="size-4"><use href="/icons.svg#cog" /></svg>`, then `<span>Settings</span>`, then the direction affordance — a second `<svg aria-hidden="true">` using the `arrow-right` glyph, classed `ml-auto size-4 transition-transform motion-reduce:transition-none group-data-[state=open]/collapsible:rotate-90`. Both glyphs are `aria-hidden` so the button's accessible name is exactly "Settings".
- `<Collapsible.Content>` wrapping `<SidebarMenuSub>`, with one `<SidebarMenuSubItem>` + `<SidebarMenuSubButton asChild isActive={...}>` + `<Link>` per entry. Sub-items are text-only — no icons — matching the approved shape. `isActive` uses the same prefix comparison the main nav uses, which satisfies D-06 through `SidebarMenuSubButton`'s own `data-active` styling; do not hand-roll active classes.

Do not add collapse/expand animation classes (`animate-collapsible-down` and friends): no such keyframes are defined in `app/globals.css`, and inventing them is outside this task's scope.

**sidebar-nav.tsx.** Delete the two `NAV_ITEMS` entries labelled General and Pricing (D-05), leaving the remaining eight in their current order. Touch nothing else in that file — the UI-SPEC E8 exact-match branch for the root route stays byte-identical. Note for reassurance, not action: no remaining entry's href is a prefix of a settings path, so removing these two cannot leave a main-list item falsely highlighted while the user is in the settings section.

**layout.tsx.** Import `SettingsNav` alongside the existing app-shell imports and render `<SettingsNav />` inside `<SidebarFooter>`, between the existing `<Separator className="mb-2" />` and `<SignOutButton />` (D-04). Leave the `Separator` exactly as it is — it is already the divider the approved shape shows above the group. Change nothing else in the layout: the server-side `getUser()` guard, the `SidebarContent` block and `SidebarInset` stay byte-identical.
  </action>
  <verify>
    <!-- planner-discipline-allow: react-collapsible — the literal appears in this task's action only as the package name the executor is told NOT to import. The gate that negative-greps it targets package.json, a file no action prose is copied into, and the action's own instruction is to add nothing there. -->
    <automated>npx tsc --noEmit</automated>
    <automated>test "$(grep -vE '^[[:space:]]*(//|\*|/\*)' components/app-shell/sidebar-nav.tsx | grep -cE 'href: "/settings')" = "0" && echo NAV_CLEARED</automated>
    <automated>test "$(grep -cE '^[[:space:]]*\{ href: "' components/app-shell/sidebar-nav.tsx)" = "8" && echo NAV_COUNT_8</automated>
    <automated>test "$(sed -n '/SidebarFooter className/,/\/SidebarFooter/p' 'app/(dashboard)/layout.tsx' | grep -oE 'SettingsNav|SignOutButton' | tr '\n' ',')" = "SettingsNav,SignOutButton," && echo FOOTER_ORDER_OK</automated>
    <automated>test "$(grep -c 'from "radix-ui"' components/app-shell/settings-nav.tsx)" = "1" && test "$(grep -c 'from "@radix-ui' components/app-shell/settings-nav.tsx || true)" = "0" && echo IMPORT_SHAPE_OK</automated>
    <automated>test "$(grep -c 'react-collapsible' package.json || true)" = "0" && test "$(grep -c 'symbol id=' public/icons.svg)" = "29" && echo NO_NEW_DEP_NO_NEW_SYMBOL</automated>
  </verify>
  <done>
`npx tsc --noEmit` is still clean (zero diagnostics, matching the recorded baseline). `NAV_CLEARED` and `NAV_COUNT_8` both print, proving the two entries are gone and the other eight survive — the comment-stripping filter means an explanatory `//` or `/** */` comment about the move does not defeat the gate. `FOOTER_ORDER_OK` prints: the slice between the footer's opening and closing tags yields exactly `SettingsNav,SignOutButton,`, which proves placement (inside the footer), order (above Sign out) and singularity (one of each) in one assertion — it reads `SignOutButton,` alone today. `IMPORT_SHAPE_OK` proves the umbrella import shape and the absence of a phantom scoped import. `NO_NEW_DEP_NO_NEW_SYMBOL` proves no collapsible package was added to package.json and the sprite still holds exactly its 29 baseline symbols.
  </done>
  <reversibility rating="reversible">Three-file client-layer change with no schema, no route and no dependency movement; a single revert restores the flat list.</reversibility>
</task>

<task type="auto">
  <name>Task 2: Prove the baselines held, then record the manual UAT script</name>
  <files>.planning/quick/260923-max-move-general-and-pricing-out-of-the-main/260923-max-SUMMARY.md</files>
  <action>
Re-run the full baseline set and compare against the numbers recorded in `<facts_established_at_planning_time>` — compare numbers, not impressions. Lint must stay at 0 errors / 13 warnings; any new warning is a regression to fix, not to narrate. Tests must stay at 33 files / 494 tests passed: this plan adds no test, so the count must be unchanged, and a changed count means something unrelated moved. The build must still emit 17 routes with both settings routes present, which is the load-bearing proof that removing the nav entries did not remove the pages.

Also assert the unchanged regions that the structural greps in Task 1 do not cover: the dashboard layout still contains its server-side `getUser()` guard and its `redirect('/login')` branch, and `components/app-shell/sign-out-button.tsx` is byte-identical to HEAD.

Then write the SUMMARY, and in it record the manual UAT script below verbatim as outstanding, with each step marked unverified unless the executor has actually observed it in a browser. Do not claim a visual or keyboard result that was not observed — this repo has no DOM harness and cannot assert any of it automatically, and a subagent self-report of a screen it did not look at is worse than an honest "outstanding".
  </action>
  <verify>
    <automated>npx tsc --noEmit</automated>
    <automated>npm run lint 2>&1 | tail -3 | grep -q '0 errors, 13 warnings' && echo LINT_BASELINE_HELD</automated>
    <automated>npm test 2>&1 | grep -q 'Tests  494 passed (494)' && echo TESTS_494_HELD</automated>
    <automated>test "$(npm run build 2>&1 | grep -E '^[├└┌].*(/settings/general|/settings/pricing)' | wc -l | tr -d ' ')" = "2" && echo BOTH_SETTINGS_ROUTES_BUILT</automated>
    <automated>grep -q 'auth.getUser()' 'app/(dashboard)/layout.tsx' && grep -q "redirect('/login')" 'app/(dashboard)/layout.tsx' && echo AUTH_GUARD_INTACT</automated>
    <automated>test "$(git hash-object components/app-shell/sign-out-button.tsx)" = "6194484f69c63040e135c0072a5b2db5b62be00e" && echo SIGNOUT_BYTE_IDENTICAL</automated>
    <human-check>
1. Load `/`. The footer shows the divider, then a "Settings" row with a cog icon and a right-pointing arrow, then Sign out. General and Pricing are absent from the main list, which now ends Home, Uploads, Verifications, Cards, Revenue, SLA, Reconciliation, Alignment.
2. Click "Settings". The arrow rotates to point down and "General" and "Pricing" appear beneath it, indented against the sub-menu rule.
3. Click "General". It navigates to the general settings page, the group stays expanded, and "General" carries the same blue active treatment the main nav uses for the current page.
4. Hard-reload the pricing settings page directly by URL. The group renders already expanded with "Pricing" active — the D-03 guarantee.
5. Navigate back to `/`. The group returns to collapsed.
6. Keyboard only: Tab to the Settings row, confirm a visible focus ring, press Enter and then Space — each toggles the group. Tab again into the revealed sub-items and press Enter to follow one.
7. In devtools, inspect the trigger: it is a `<button>`, its accessible name is "Settings", `aria-expanded` flips false to true on toggle, and `aria-controls` resolves to the id of the element holding the sub-items.
8. Narrow the viewport below 768px, open the sheet from the top-bar trigger, and repeat steps 1-4 inside the sheet (D-08).
    </human-check>
  </verify>
  <done>
Every automated gate prints its sentinel: typecheck clean, `LINT_BASELINE_HELD`, `TESTS_494_HELD`, `BOTH_SETTINGS_ROUTES_BUILT`, `AUTH_GUARD_INTACT`, `SIGNOUT_BYTE_IDENTICAL`. The SUMMARY exists, records the measured-versus-baseline numbers, and carries the eight-step UAT script with an honest verified/outstanding mark against each step.
  </done>
</task>

</tasks>

<source_coverage_audit>
Four source types audited. No unplanned items.

| Source | Item | Status | Where covered |
|--------|------|--------|---------------|
| GOAL | Move General and Pricing out of the main sidebar list into a collapsible Settings group pinned above Sign out | COVERED | Task 1 |
| REQ | — | N/A | No REQUIREMENTS.md — it was removed at the v1.0 milestone close (commit 75219f7). This is a quick task, not a roadmap phase. |
| RESEARCH | — | N/A | No RESEARCH.md for this quick task. Its role is served by `<facts_established_at_planning_time>`, measured live in this repo on 2026-09-23. |
| CONTEXT | D-01 one Settings row, cog, collapsed by default, direction affordance | COVERED | Task 1 (trigger + rotated `arrow-right`) |
| CONTEXT | D-02 expands to General and Pricing sub-items | COVERED | Task 1 (`Collapsible.Content` + `SidebarMenuSub`) |
| CONTEXT | D-03 auto-expanded on a settings route | COVERED | Task 1 (`inSettings` -> `defaultOpen` + `key`), UAT step 4 |
| CONTEXT | D-04 lives in the footer above Sign out | COVERED | Task 1 layout wiring, `FOOTER_ORDER_OK` gate |
| CONTEXT | D-05 removed from main NAV_ITEMS | COVERED | Task 1, `NAV_CLEARED` + `NAV_COUNT_8` gates |
| CONTEXT | D-06 sub-item active styling matches the nav | COVERED | Task 1 (`isActive` on `SidebarMenuSubButton`), UAT step 3 |
| CONTEXT | D-07 no new npm dependency | COVERED | Task 1, `IMPORT_SHAPE_OK` + `NO_NEW_DEPS_NO_SPRITE_CHANGE` gates |
| CONTEXT | D-08 works in the mobile Sheet | COVERED | UAT step 8 |

Out of scope by instruction, deliberately not planned: the settings pages themselves, their Server Actions, the ingestion pipeline, the database, and every reporting page.
</source_coverage_audit>

<planner_contribution_detectors>
Recorded so a reader knows these were evaluated, not ignored.

- **schema-gate** (`workflow.schema_push_detection`): no schema-relevant file is in scope — no `supabase/migrations/*.sql`, no ORM schema file. Skipped.
- **api-coverage** (`workflow.api_coverage_gate`): not enabled in `.planning/config.json`, and this work integrates no external API — it is a client-side navigation change over components already in the repo. No `COVERAGE.md` is produced; if one is ever demanded, the correct content is the reasoned declaration `No external API integration: client-side sidebar navigation only`.
- **assumption-delta** (`workflow.assumption_delta`): not enabled, and the detector resolves phase sections from ROADMAP.md, which a quick task has no entry in — it would report `phase_unresolved`, which is a skip and not a `detected:false` verdict. Skipped rather than asserted either way.
- **security** (`workflow.security_enforcement`, ASVS level 1, block on high): enabled by default. Threat model below.
</planner_contribution_detectors>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser -> Next server | Pre-existing. This change adds no new crossing: `settings-nav.tsx` is a `"use client"` leaf with no fetch, no Server Action call and no data access. |
| unauthenticated -> dashboard | Pre-existing, enforced in `proxy.ts` and again by the layout's `getUser()` guard. Untouched by this plan. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-260923-max-01 | Information disclosure | `components/app-shell/settings-nav.tsx` link visibility | low | accept | The two links are visible to exactly the same audience as before the move — any authenticated user of this internal tool. Link placement is not an authorization control, so no control is added or removed here. |
| T-260923-max-02 | Elevation of privilege | route access to `/settings/*` | low | accept | Access is gated by `proxy.ts`, the dashboard layout's `getUser()` redirect, and each settings Server Action's own checks. None are in `files_modified`; a nav change cannot grant route access. |
| T-260923-max-03 | Tampering | `app/(dashboard)/layout.tsx` server guard | low | mitigate | The only layout edit is one import and one child element inside `SidebarFooter`. Task 2's `AUTH_GUARD_INTACT` gate asserts both `auth.getUser()` and the `redirect('/login')` branch still exist, so an accidental deletion of the second enforcement layer fails the plan rather than shipping. |
| T-260923-max-04 | Tampering | icon sprite `public/icons.svg` | low | mitigate | No new `<symbol>` is added (a symbol lacking `fill="none" stroke="currentColor" stroke-width="2"` renders as a solid blob — quick task 260914-ot4). Task 1's `NO_NEW_DEPS_NO_SPRITE_CHANGE` gate asserts the sprite is byte-identical. |

No `T-260923-max-SC` supply-chain row: this plan runs **no** package-manager install. `radix-ui` is already a direct dependency and `@radix-ui/react-collapsible` is reached only through it, so the package legitimacy gate does not apply and no `## Package Legitimacy Audit` is required.
</threat_model>

<verification>
Automated, in order:
1. `npx tsc --noEmit` — must stay clean (baseline: zero diagnostics).
2. `npm run lint` — must stay at 0 errors, 13 warnings.
3. `npm test` — must stay at 33 files / 494 tests passed. This plan adds no test; an increase means something unrelated moved.
4. `npm run build` — must succeed and still list both settings routes.
5. The five structural greps in Task 1 and the two unchanged-region gates in Task 2.

Manual, deferred to UAT and recorded honestly as outstanding in the SUMMARY unless actually observed: the eight-step `<human-check>` script in Task 2, which is the only place the visual, keyboard and ARIA behaviour can be confirmed — this repo has no jsdom or React Testing Library harness and none is to be created for this task.
</verification>

<success_criteria>
- The main sidebar list has eight entries; neither settings page appears in it.
- A collapsible "Settings" row sits in the sidebar footer directly above Sign out, collapsed on non-settings routes and expanded on settings routes.
- Its trigger is a `<button>` with the accessible name "Settings", keyboard-operable, carrying `aria-expanded` and `aria-controls`.
- Sub-items "General" and "Pricing" link to their pages and take the same active treatment as the rest of the nav.
- `package.json`, `package-lock.json` and `public/icons.svg` are byte-identical.
- Typecheck, lint, tests and build all match their recorded baselines.
</success_criteria>

<output>
Create `.planning/quick/260923-max-move-general-and-pricing-out-of-the-main/260923-max-SUMMARY.md` when done, including the measured-versus-baseline table and the outstanding UAT script.
</output>
