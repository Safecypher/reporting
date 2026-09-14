---
quick_id: 260914-ot4
type: execute
mode: quick
description: "Fix icon sprite glyphs rendering as solid black silhouettes — add stroke presentation attributes to every <symbol> in public/icons.svg"
files_modified:
  - public/icons.svg
autonomous: true
windows_ref: 6

estimate:
  tokens: 18000
  raw_tokens: 12000
  tasks: 2
  confidence: low

must_haves:
  truths:
    - "Every one of the 29 sprite symbols renders as stroked outline geometry, not a filled silhouette"
    - "An icon inside a coloured container (e.g. text-destructive) takes that colour, because the symbol reads currentColor"
    - "The 5 intentional solid dots remain solid dots — they are not flattened to outlines"
    - "No call site changes: the ~30 existing <use href=\"/icons.svg#id\"> references all still resolve"
  artifacts:
    - "public/icons.svg — 29 <symbol> elements each carrying the 5 presentation attributes"
  key_links:
    - "symbol-level stroke=\"currentColor\" ← CSS color from Tailwind classes on the referencing <svg> at each call site"
    - "child fill=\"currentColor\" on 5 <circle> elements overrides the inherited fill=\"none\""
---

<objective>
`public/icons.svg` contains **zero** `stroke=` attributes. Its 29 `<symbol>` elements hold
stroke-style (outline) geometry, so with no `fill`/`stroke` set SVG falls back to its default
`fill: black; stroke: none`. Three consequences, all live today:

1. **Outline shapes fill solid.** `#alert` is `M12 3 2 21h20L12 3Z` — a triangle *outline* that
   fills as a solid black triangle. `#check` is `circle r=9` plus a tick — a solid black disc.
2. **Interior detail vanishes.** Zero-area detail strokes (the `!` bar `M12 10v5` in `#alert`, the
   tick `m8 12 3 3 5-6` in `#check`) enclose no area, so filling renders them as nothing.
3. **Colour never lands.** ~30 call sites across `app/(dashboard)/**` and `components/**` correctly
   apply Tailwind colour classes (`text-destructive`, `text-muted-foreground`, …), but those set the
   CSS `color` property, which reaches an icon only through `currentColor`. Nothing in the sprite
   reads it.

The geometry is Lucide-derived (`#rotate` is `M21 12a9 9 0 1 1-3.2-6.9`, verbatim Lucide), so this
restores the presentation convention the icons were authored for. It is not a guess at a weight.

Purpose: restore the at-a-glance status-colour affordance (WINDOWS.md entry 6, weakens SC5/ALIGN-05).
Output: one modified file, `public/icons.svg`. No component, dependency, or migration changes.

**Scope fence.** This is a pre-existing, app-wide defect found during Phase 6 UAT. It was **not**
introduced by Phase 6 and must not be folded into any phase's artifacts. The only files this task
may touch are `public/icons.svg` and this quick task's own `PLAN.md` / `SUMMARY.md`.
</objective>

<execution_context>
@~/.claude/gsd-core/workflows/execute-plan.md
@~/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/WINDOWS.md
@CLAUDE.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add the five presentation attributes to all 29 symbols</name>

  <files>public/icons.svg</files>

  <read_first>
`public/icons.svg` in full (139 lines, 29 `<symbol>` elements). Confirm before editing:

- `grep -c '<symbol ' public/icons.svg` → **29**
- `grep -c 'stroke=' public/icons.svg` → **0** (the defect)
- `grep -o 'fill="currentColor"' public/icons.svg | wc -l` → **5** (the intentional dots)

All 29 opening tags are currently single-line and structurally identical:
`<symbol id="NAME" viewBox="0 0 24 24">`
  </read_first>

  <action>
Append this exact attribute string to **each** of the 29 `<symbol>` opening tags, immediately after
the existing `viewBox="0 0 24 24"` and before the closing `>`:

fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"

Each opening tag becomes, for example:
`<symbol id="shield" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">`

Because all 29 tags are byte-identical apart from the id, prefer one anchored substitution over 29
hand edits — it cannot typo and it cannot match a non-symbol line (note the macOS `sed -i ''` form):

sed -i '' 's|<symbol id="\([^"]*\)" viewBox="0 0 24 24">|<symbol id="\1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">|' public/icons.svg

**Put the attributes on the `<symbol>` elements, NOT on the sprite's root `<svg>`.** This is the one
real technical trap here. When `<use href="/icons.svg#id">` references an *external* document
fragment, the cloned shadow content inherits from the `<use>` element's position in the
*referencing* document — not from ancestors in the source document. Attributes on the sprite's root
`<svg>` would therefore never reach the symbols, and the bug would look unfixed. Attributes on the
`<symbol>` itself are part of the referenced fragment and do apply.

**Leave the 5 intentional filled dots exactly as they are.** Five `<circle>` elements already carry
`fill="currentColor"` (lines 51, 87, 100, 101, 102 — in `#alert`, `#signal`, `#robot`). A child's own
`fill="currentColor"` overrides the `fill="none"` inherited from its `<symbol>`, so they survive
untouched and stay solid. Do not add, remove, or rewrite any of them.

**Change nothing else.** No path geometry, no `viewBox`, no `id`, no `<defs>` block, no root `<svg>`
attributes. The 29 ids are referenced by ~30 call sites; renaming one breaks a page.

**Do not change any component.** The call sites already set size and colour classes correctly — that
is precisely why fixing the sprite alone is sufficient. If a component genuinely appears to need a
change, stop and record it as a finding in the SUMMARY; do not edit it silently.

Known, accepted visual consequence to record (not a defect to chase): the 5 dot circles now also
inherit `stroke-width="2"`, so each renders ~1 unit fatter in radius than authored — `#alert`'s
`r=".6"` dot reads at an effective ~1.6 units against Lucide's ~1. They remain small solid dots in
the correct colour. Adding `stroke="none"` to those circles would restore the exact authored radius,
but that edits the protected dot elements and is out of scope here. Note it in the SUMMARY as an
optional follow-up; do not act on it.
  </action>

  <acceptance_criteria>
All six assertions below are scoped to `public/icons.svg` only — no repo-wide greps.

1. Symbol count unchanged: 29
2. All 29 symbols carry all five attributes
3. Exactly 5 `fill="currentColor"` occurrences remain, all on `<circle>` elements
4. The symbol id set is byte-identical to the original 29
5. The diff touches `<symbol ` lines and nothing else (proves no geometry/viewBox/dot was altered)
6. Line-count parity: 29 lines added, 29 removed
  </acceptance_criteria>

  <verify>
    <automated>grep -c '<symbol ' public/icons.svg</automated>
    <fails_when>Output is not exactly `29`. A lower number means a symbol opening tag was mangled or deleted; higher means one was duplicated.</fails_when>

    <automated>grep '<symbol ' public/icons.svg | grep 'fill="none"' | grep 'stroke="currentColor"' | grep 'stroke-width="2"' | grep 'stroke-linecap="round"' | grep -c 'stroke-linejoin="round"'</automated>
    <fails_when>Output is not exactly `29`. Any number below 29 names the real failure directly: that many symbols got the full attribute set and the rest were missed — those missed symbols still render as solid black silhouettes.</fails_when>

    <automated>grep -o 'fill="currentColor"' public/icons.svg | wc -l</automated>
    <fails_when>Output is not exactly `5`. Below 5 means an intentional solid dot was flattened to an outline (a regression — `#alert`'s `!` dot, `#signal`'s antenna dot, or `#robot`'s eyes/antenna would go hollow). Above 5 means `fill="currentColor"` was wrongly added to a symbol or path, which would re-introduce the solid-silhouette bug on that glyph.</fails_when>

    <automated>grep -c '<circle[^>]*fill="currentColor"' public/icons.svg</automated>
    <fails_when>Output is not exactly `5`. The 5 `fill="currentColor"` occurrences exist but are no longer all on `<circle>` elements — one migrated onto a path or symbol.</fails_when>

    <automated>grep -o '<symbol id="[^"]*"' public/icons.svg | sed 's/.*id="//;s/"//' | sort | tr '\n' ' '</automated>
    <fails_when>Output is not exactly: `alert arrow-right badge bank calendar card chart check chip clock cog database eye fingerprint key laptop layers lock menu phone plus robot rotate search shield signal tools user x ` — any missing, added, or renamed id breaks the `<use href="/icons.svg#id">` call sites that reference it, and the icon silently disappears from that page.</fails_when>

    <automated>git diff -U0 -- public/icons.svg | grep -E '^[+-][^+-]' | grep -v '<symbol ' | wc -l</automated>
    <fails_when>Output is not `0`. A non-zero count is the number of changed lines that are NOT symbol opening tags — i.e. path geometry, a `viewBox`, a dot circle, `<defs>`, or the root `<svg>` was edited when it should not have been. Read the `wc` output, not the exit code: the intermediate `grep -v` correctly exits 1 when it filters everything out, which is the success case here.</fails_when>

    <automated>git diff --numstat -- public/icons.svg</automated>
    <fails_when>Output is not `29	29	public/icons.svg`. Anything else means lines were added or removed rather than rewritten in place.</fails_when>
  </verify>

  <done>
`public/icons.svg` has all 29 `<symbol>` elements carrying
`fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
exactly 5 `fill="currentColor"` circles remain untouched; the id set is unchanged; and the diff is
confined to the 29 symbol opening tags (29 added / 29 removed).
  </done>
</task>

<task type="auto">
  <name>Task 2: Prove no regression across the toolchain</name>

  <files>(no files modified — verification only)</files>

  <read_first>
Nothing new. Task 1 must be complete and its assertions green before running this.

Context for interpreting the numbers: no test file in this repo references `icons.svg`
(`grep -rln "icons" --include="*.test.ts" .` returns nothing across 26 test files). The suite is
therefore a pure regression guard here — a one-file SVG presentation-attribute change cannot
legitimately alter any test outcome. Any movement in the test numbers means something else broke.
  </read_first>

  <action>
Run the three toolchain gates below and record the actual observed output in the SUMMARY — the real
numbers, not "passed".

The stated baselines are 361 tests and 17 routes. If the *pre-change* numbers on this working tree
differ from those, do not treat that as this task's failure: the comparison that matters is
pre-change vs post-change on the same tree. Record the actual pre-change figure and compare against
it, and note the discrepancy with the stated baseline in the SUMMARY.

Do not fix unrelated pre-existing failures found here — record them as findings. This task's scope
is proving that the sprite change broke nothing.
  </action>

  <acceptance_criteria>
- TypeScript compiles clean
- Vitest is at the 361 baseline (or the recorded pre-change figure), with zero failures
- The production build succeeds at 17 routes
- The git working tree shows `public/icons.svg` as the only modified source file
  </acceptance_criteria>

  <verify>
    <automated>npx tsc --noEmit</automated>
    <fails_when>Any diagnostic is printed. Clean means no output and exit 0. (An SVG asset change cannot produce a type error — any output here is pre-existing or was caused by editing something outside `public/icons.svg`.)</fails_when>

    <automated>npx vitest run</automated>
    <fails_when>The summary line is not `Tests  361 passed (361)` — specifically, any `failed` count above 0, or a total below 361 indicating tests were lost. Report the observed `passed`/`failed`/`total` triple verbatim.</fails_when>

    <automated>npm run build</automated>
    <fails_when>The build exits non-zero, or the route table does not list 17 routes. A missing route means the build tree changed, which this task's diff cannot legitimately cause.</fails_when>

    <automated>git status --porcelain</automated>
    <fails_when>Any line other than ` M public/icons.svg` and the quick task's own `.planning/quick/260914-ot4-*/` artifacts appears. A component or `.planning/` phase file showing as modified means the scope fence was breached.</fails_when>
  </verify>

  <done>
`npx tsc --noEmit` clean, `npx vitest run` at 361/361 with zero failures, `npm run build` green at 17
routes, and `public/icons.svg` is the only modified source file. Observed figures recorded verbatim
in the SUMMARY.
  </done>
</task>

</tasks>

<verification>
## What the automated gate does and does not prove

The structural assertions in Task 1 prove the sprite now carries the correct presentation attributes
on the correct elements, that the protected dots survived, and that nothing outside the symbol
opening tags moved. Task 2 proves the change broke no types, tests, or routes.

**None of this proves the icons actually look right.** SVG rendering is not exercised by this repo's
test suite, and no assertion here can tell a well-formed outline from an ugly one. The automated gate
is the completion criterion for this quick task; the visual check below is a recommended glance, and
**does not block** the task.

## Human glance (recommended, non-blocking)

Run `npm run dev` and look at any dashboard page. Three concrete things to eyeball:

1. **`#alert` reads as an outline triangle with a visible `!`.** Easiest place: trigger or inspect a
   `TileErrorBoundary` fallback (`components/dashboard/tile-error-boundary.tsx:36`) or the home
   `ErrorState` (`app/(dashboard)/page.tsx:137`). Before the fix this was a solid black triangle
   with no `!` at all. After, the triangle should be hollow with a clear exclamation bar and dot.
2. **Colour now lands.** Those same two call sites wrap the icon in
   `className="size-8 text-destructive"`. The glyph should render **red**, not black. This is the
   whole point of the fix and the single most diagnostic check.
3. **The dots are still solid, and slightly fatter than authored.** `#alert`'s `!` dot, `#signal`'s
   antenna dot, and `#robot`'s two eyes should be solid filled dots in the icon's colour — not
   hollow rings. They will render ~1 unit larger in radius than Lucide's equivalents because they
   now inherit `stroke-width="2"` (documented and accepted in Task 1). If they read as too heavy at
   `size-4`, the fix is `stroke="none"` on those 5 circles — raise it as a follow-up, not here.

Also worth a passing look: `#check` (should be a ring with a tick, previously a solid disc) and
`#chip` (inner square should be hollow).
</verification>

<success_criteria>
- All 29 symbols carry the five presentation attributes; 0 symbols missed
- Exactly 5 `fill="currentColor"` circles remain, unmodified
- The 29-id set is unchanged
- The diff is confined to the 29 symbol opening tags (29 added / 29 removed)
- `npx tsc --noEmit` clean; `npx vitest run` 361/361; `npm run build` 17 routes
- `public/icons.svg` is the only modified source file
- WINDOWS.md entry 6 is a candidate to mark fixed — flag this in the SUMMARY for the orchestrator;
  do not edit WINDOWS.md from inside this task
</success_criteria>

<output>
Create `.planning/quick/260914-ot4-fix-icon-sprite-glyphs-rendering-as-soli/SUMMARY.md` when done.

Record in it: the observed value of every assertion (actual numbers, not "passed"); the accepted
dot-fattening consequence and its optional `stroke="none"` follow-up; any discrepancy between the
stated 361/17 baselines and the pre-change figures; and a note that WINDOWS.md entry 6 is ready to
be marked fixed pending the human glance.
</output>
