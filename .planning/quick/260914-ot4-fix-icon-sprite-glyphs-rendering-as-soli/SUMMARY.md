---
quick_id: 260914-ot4
slug: fix-icon-sprite-glyphs-rendering-as-soli
date: 2026-09-14
status: complete
commits:
  - 9e55eba
files_changed:
  - public/icons.svg
---

# Fix icon sprite glyphs rendering as solid black silhouettes

## What was wrong

`public/icons.svg` contained **zero** `stroke=` attributes. Its 29 `<symbol>` elements hold
stroke-style (outline) geometry, but with no `fill`/`stroke` set, SVG falls back to its default
`fill: black; stroke: none`. Three consequences, all visible:

1. **Outline shapes filled solid.** `#alert` is `M12 3 2 21h20L12 3Z` — a triangle *outline* that
   filled as a solid black triangle. `#check` is `circle r=9` plus a tick — a solid black disc.
2. **Interior detail vanished.** Zero-area detail strokes (the `!` bar `M12 10v5` in `#alert`, the
   tick `m8 12 3 3 5-6` in `#check`) enclose no area, so filling rendered them as nothing.
3. **Colour never landed.** ~20 call sites across `app/(dashboard)/**` correctly apply Tailwind
   colour classes (`text-destructive`, `text-muted-foreground`, …), but those set the CSS `color`
   property, which reaches an icon only through `currentColor`. Nothing in the sprite read it, so
   every glyph rendered black regardless of its container's intent.

Reported by the user during Phase 6 UAT as "the glyphs are all black and not necessarily obvious".
Pre-existing and app-wide — **not** introduced by Phase 6.

## What changed

One file. Appended five presentation attributes to each of the 29 `<symbol>` opening tags:

```
fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
```

These are Lucide's own defaults, and the geometry is Lucide-derived (`#rotate` is
`M21 12a9 9 0 1 1-3.2-6.9`, verbatim Lucide) — so this restores the convention the icons were
authored for rather than guessing a stroke weight.

**Why on `<symbol>` and not the sprite's root `<svg>`:** with an external
`<use href="/icons.svg#id">`, the cloned shadow content inherits from the `<use>` element's
position in the *referencing* document, not from ancestors in the source document. Root-level
attributes would have looked correct in the file and still rendered black — the bug would have
appeared unfixed.

No component was changed. The call sites already set size and colour correctly; that is precisely
why the fix belonged in the sprite.

## Verification

Structural assertions — all scoped to `public/icons.svg`:

| Check | Expected | Actual |
|---|---|---|
| `<symbol>` count | 29 | **29** |
| Symbols carrying all five attributes | 29 | **29** |
| `fill="currentColor"` occurrences (the intentional dots) | 5 | **5** |
| Those dots still on `<circle>` elements | 5 | **5** |
| Symbol id set | unchanged, 29 ids | **unchanged** |
| Non-`<symbol>` changed lines in the diff | 0 | **0** |
| `git diff --numstat` | 29 29 | **29 29** |

The id set verified present and unchanged: `alert arrow-right badge bank calendar card chart check
chip clock cog database eye fingerprint key laptop layers lock menu phone plus robot rotate search
shield signal tools user x`.

Toolchain gate:

| Command | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` | **361/361** across 26 files (baseline 361 — no regression) |
| `npm run build` | 16 routes + `ƒ Proxy (Middleware)` = the 17 entries reported as the baseline |
| `git status --porcelain` | clean |

**Route-count note:** the "17 routes" baseline counts the 16 entries in the `Route (app)` table
plus the `ƒ Proxy (Middleware)` line. Confirmed identical to the pre-change baseline — and a static
asset under `public/` cannot alter Next's route manifest in any case.

## Honest limitations

1. **None of the above proves the icons *look* right.** Every check is structural or a regression
   guard; no test in the repo references `icons.svg` (checked across all 26 test files), so the
   361-test suite is a pure regression guard here, not evidence the fix works. **This needs a human
   glance.** Three concrete things to eyeball:
   - `#alert` now reads as a triangle *outline* with a visible `!` inside, not a solid black triangle
   - an icon inside a `text-destructive` container renders **red**, not black
   - the five dots are still solid dots, not hollow rings
2. **Accepted cosmetic consequence.** The five preserved dots now also inherit `stroke-width="2"`,
   so `#alert`'s `r=".6"` dot renders at an effective radius of roughly 1.6 units rather than ~1 —
   a visibly fatter dot, still correctly solid and correctly coloured. Adding `stroke="none"` to
   those five circles would restore the authored radius, but would edit the protected elements and
   break the symbol-lines-only diff assertion. Left as-is deliberately; **optional follow-up**.

## Execution note

The dispatched executor terminated early on an API error ("the response stopped arriving") after
committing the fix and after `tsc` and Vitest had passed, but before running the production build
or writing this summary. The commit `9e55eba` was already on disk and the working tree was clean,
so rather than re-dispatching, the orchestrator completed the remaining tail directly: all seven
structural assertions, the production build, this SUMMARY.md, and the STATE.md row. Every check
recorded above was actually run — none is carried over from the failed agent's partial output.

## Follow-up

`.planning/WINDOWS.md` **entry 6** tracks this defect and is ready to be marked fixed. It was
deliberately not edited from inside this task.
