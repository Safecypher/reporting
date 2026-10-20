---
phase: 14-storage-first-manual-upload
plan: 02
subsystem: ingestion
tags: [papaparse, node-streams, exceljs, memory, billing, netlify-background-function, tdd]

requires:
  - phase: 13-background-ingestion
    provides: "claimFile / processClaimedFile split, handler registry, background function runPendingFile"
provides:
  - "extractHeaderSignature reads a 64 KiB slice (HEADER_SLICE_BYTES) with preview 1: the synchronous claim no longer scales with file size"
  - "XLSX cap inside claimFile (MAX_XLSX_BYTES 15 MiB, XLSX_TOO_LARGE_REASON): kept, finalised failed, never reaches ExcelJS"
  - "csvWindows(bytes, windowRows?) bounded-memory CSV reader plus windowed billing branch in processClaimedFile(claim, deps, options?)"
  - "scripts/gen-synthetic-billing.mjs and scripts/bench-ingest-memory.mts so the memory numbers can be re-taken"
affects: [14-01, 14-04, 14-06, phase-14-deployed-proof]

actuals:
  tokens: 31000
  tasks: 3
  commits: 5
plan_head_before: 419c925a125b17dad34e0dba28bd49c0dcde1e0a
plan_head_after: da74dfee2fb37d894697d4598d7475da4f826c16
commits: 5

tech-stack:
  added: []
  patterns:
    - "Backpressure applied to the slice generator, never to Papa (Papa left flowing)"
    - "Header handled outside Papa in stream mode; Papa streams plain row arrays"
    - "Windowed processing proven identical to whole-file by equivalence tests at three window sizes"

key-files:
  created:
    - lib/ingestion/xlsx-cap.ts
    - lib/ingestion/csv-windows.ts
    - lib/ingestion/__tests__/csv-windows.test.ts
    - scripts/gen-synthetic-billing.mjs
    - scripts/bench-ingest-memory.mts
  modified:
    - lib/ingestion/index.ts
    - lib/ingestion/__tests__/ingestion.test.ts

key-decisions:
  - "csvWindows does its own header handling and feeds Papa header:false, because Papa's Node-stream mode corrupts repeated cell values after each pause/resume in the first chunk"
  - "Backpressure is a gate in the slice generator (hold the next 1 MiB slice while a finished window is unconsumed), not parser.pause() and not for-await"
  - "The XLSX cap answers through the existing 'unrecognised' result kind; ClaimFileResult and types.ts are untouched (14-01 stays file-disjoint)"
  - "Bench fake DB dedups on a 52-bit key hash, not Set<string>, so it does not dominate the RSS being measured"

patterns-established:
  - "Memory claims are re-measurable from the repo with a deterministic generator and a bench script"
  - "Fence diff against e55abda over handlers, parsers, classify, normalise*, hash, file-date and types stays empty"

requirements-completed: [P14-03, P14-10, P14-11, P14-14]

coverage:
  - id: D1
    description: "CSV classification in claimFile hands Papa.parse at most 64 KiB, identically for all five CSV fixtures, a ~2 MB synthetic billing file and a BOM-prefixed file"
    requirement: P14-10
    verification:
      - kind: unit
        ref: "lib/ingestion/__tests__/ingestion.test.ts#claimFile memory bounds (14-02)"
        status: pass
      - kind: other
        ref: "node --import tsx --max-old-space-size=300 scripts/bench-ingest-memory.mts <99 MiB billing> --mode claim (peakRssMb 209, 34 ms)"
        status: pass
    human_judgment: false
  - id: D2
    description: "An XLSX over 15 MiB is recorded with its bytes kept, finalised failed with XLSX_TOO_LARGE_REASON, and never loaded into ExcelJS; at-cap and already-uploaded cases behave as specified"
    requirement: P14-14
    verification:
      - kind: unit
        ref: "lib/ingestion/__tests__/ingestion.test.ts#claimFile XLSX cap (14-02, D-16)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Windowed billing processing is identical to whole-file processing (accepted, duplicates, rejected with whole-file row numbers, excluded, four-way invariant) at window sizes 1, 3 and 50,000, one window held at a time"
    requirement: P14-11
    verification:
      - kind: unit
        ref: "lib/ingestion/__tests__/csv-windows.test.ts#processClaimedFile windowed billing is identical to whole-file processing"
        status: pass
    human_judgment: false
  - id: D4
    description: "csvWindows rows equal Papa.parse whole-file rows for BOM, CRLF, quoted commas/newlines, multibyte, blank lines, repeated/empty cells, ragged rows, duplicate headers, header-only, empty, and an emoji straddling the first 1 MiB slice boundary"
    requirement: P14-11
    verification:
      - kind: unit
        ref: "lib/ingestion/__tests__/csv-windows.test.ts#csvWindows equivalence with whole-file Papa.parse"
        status: pass
    human_judgment: false
  - id: D5
    description: "Windowed billing of a 99 MiB / 986,000-row file completes inside the memory budget at a 600 MB, and at a 200 MB, heap"
    requirement: P14-03
    verification:
      - kind: other
        ref: "node --import tsx --max-old-space-size=600 scripts/bench-ingest-memory.mts <99 MiB in-window billing> --mode process (peakRssMb 550)"
        status: pass
    human_judgment: true
    rationale: "Local macOS numbers, not Netlify's 1024 MB function; the deployed 99 MiB proof in 14-06 is what closes D-06"

duration: 14min
completed: 2026-10-20
status: complete
---

# Phase 14 Plan 02: Memory-safe ingestion at 100 MB Summary

**64 KiB header slice, a 15 MiB XLSX cap inside claimFile, and 50,000-row windowed billing through Papa's Node-stream mode (with the header handled outside Papa to avoid a value-corrupting Papa bug), proven equivalent to whole-file processing and measured at 464-550 MB peak RSS for a 99 MiB file**

## Performance

- **Duration:** 14 min
- **Started:** 2026-10-20T18:23:00Z
- **Completed:** 2026-10-20T18:37:15Z
- **Tasks:** 3 (two TDD)
- **Files modified:** 7 (5 created, 2 modified)

## Accomplishments

- `extractHeaderSignature` decodes only `HEADER_SLICE_BYTES` (65,536) and parses `preview: 1`. Spy tests prove no `Papa.parse` call during `claimFile` receives more than 65,536 characters for every CSV fixture and a 2 MB synthetic billing file; classification is unchanged.
- `claimFile` refuses to hand an XLSX above `MAX_XLSX_BYTES` (15,728,640) to ExcelJS: the object is recorded with its bytes (reportType null), finalised `failed` with `XLSX_TOO_LARGE_REASON`, and returned as the existing `unrecognised` kind. `claimFile`'s signature and its three result kinds, and `lib/ingestion/types.ts`, are unchanged, so 14-01's `ingestInboxObject` is unaffected.
- `processClaimedFile(claim, deps, options?)` runs billing CSVs in bounded windows: header assertion on the first 64 KiB through the existing guarded `handler.parse`, then per window `validate` (reject row numbers offset to whole-file numbers), `normalise`, `upsert`, strictly sequential, one `finalizeFile`. Other report types and XLSX take the whole-file path byte-for-byte.
- Two scripts let anyone re-take the numbers (see Measurements).

## Measurements (local, macOS arm64, Node 24.22; synthetic data, nothing touched a network or database)

| Run | Result |
|-----|--------|
| 99 MiB in-window billing, `--mode process`, heap 600 MB | `{"mode":"process","bytes":103975097,"rows":986000,"accepted":986000,"duplicates":0,"rejected":0,"excluded":0,"ms":2046,"peakRssMb":550}` |
| same file, heap 200 MB | `{"mode":"process","bytes":103975097,"rows":986000,"accepted":986000,"duplicates":0,"rejected":0,"excluded":0,"ms":2161,"peakRssMb":464}` |
| 99 MiB pre-window billing, `--mode claim`, heap 300 MB | `{"mode":"claim","bytes":103975097,"rows":0,"accepted":0,"duplicates":0,"rejected":0,"excluded":0,"ms":34,"peakRssMb":209,"reportType":"billing"}` |
| 2 MiB default (pre-window), `--mode process` | `{"mode":"process","bytes":2297838,"rows":22000,"accepted":0,"duplicates":0,"rejected":0,"excluded":22000,"ms":39,"peakRssMb":146}` |

Bounds from the plan: process peakRssMb <= 700 (550), rows >= 900,000 (986,000); claim peakRssMb <= 450 (209); 2 MiB run accepted 0 and excluded == rows (22,000). Research baseline before this plan: claim 983 MB, process 1,463-1,535 MB at 100 MB.

## Task Commits

1. **Task 1: 64 KiB header slice + XLSX cap** - `133765c` (test, RED), `01e6416` (feat, GREEN)
2. **Task 2: windowed billing** - `aa3fcfa` (test, RED), `13bba95` (feat, GREEN)
3. **Task 3: generator and bench scripts** - `da74dfe` (chore)

**Plan metadata:** committed with this SUMMARY (docs: complete plan)

## Files Created/Modified

- `lib/ingestion/xlsx-cap.ts` - `MAX_XLSX_BYTES`, `XLSX_TOO_LARGE_REASON`; zero imports, client-safe
- `lib/ingestion/csv-windows.ts` - `CSV_SLICE_BYTES`, `CSV_WINDOW_ROWS`, `csvWindows`
- `lib/ingestion/index.ts` - `HEADER_SLICE_BYTES`, sliced header read, XLSX cap in `claimFile`, `WINDOWED_REPORT_TYPES`, windowed branch
- `lib/ingestion/__tests__/ingestion.test.ts` - slice-bound and XLSX-cap cases (additions only)
- `lib/ingestion/__tests__/csv-windows.test.ts` - equivalence and accounting tests (24+ cases)
- `scripts/gen-synthetic-billing.mjs` - deterministic, pre-window-by-default generator
- `scripts/bench-ingest-memory.mts` - peak-RSS bench against in-memory `IngestDeps`

## TDD Gate Compliance

- Task 1 RED `133765c`: 3 target tests failed on their planned assertions (`HEADER_SLICE_BYTES` undefined; a 2,237,907-char string reached `Papa.parse`; over-cap XLSX returned "unrecognised report type" instead of the cap reason). `xlsx-cap.ts` was scaffolded in the RED commit so the test file could import it. GREEN `01e6416`: 234 ingestion tests pass.
- Task 2 RED `aa3fcfa`: 11 of 24 failed on assertions (no rows yielded; 1 upsert instead of 5). `csv-windows.ts` was scaffolded with final constants and a no-op generator. GREEN `13bba95`: all pass.
- Note: RED evidence was validated by inspecting runner output, not with `gsd_run check tdd-red-evidence` (no persisted TAP record was produced). No REFACTOR commits.

## Decisions Made

- Papa's header mode is not used in stream mode (see Deviation 1); the header logic (BOM strip, duplicate rename `name_1`, `__parsed_extra`, short rows) is replicated in `csv-windows.ts` and locked by equivalence tests.
- Backpressure is applied to the slice generator. `for await` over Papa's stream and `parser.pause()` per window both measured far too slow (24 s and 6 s per 300,000 rows against 0.19 s).
- The bench's fake DB dedups on a 52-bit key hash rather than `Set<string>`: with a string Set the 99 MiB run read 763 MB at a 600 MB heap (over the 700 MB bound) and died at a 200 MB heap, because the fake table, not ingestion, was the memory. The comment in the script records this.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Research's windowed-CSV prototype silently corrupts rows with repeated cell values**
- **Found during:** Task 2 (emoji slice-boundary test, whose `filler,filler` rows exposed it)
- **Issue:** Papa's Node-stream mode pauses every 16 rows (output buffer full) and resumes by re-entering its parser with the first chunk's base index of 0. Papa then treats the next data row as a header and rewrites its repeated values (`"x","x"` became `"x","x_1"`), also for pairs of empty cells. Any billing row with two equal cells within the first 1 MiB would be altered, changing validation outcomes (for example a missing-region reason lost). Research's equivalence harness missed it because its data had no repeated values.
- **Fix:** `csvWindows` streams with `header: false` and builds the row objects itself, replicating header-mode semantics exactly (BOM strip, duplicate header rename, `__parsed_extra`, short rows). Added equivalence cases for repeated/empty cells past row 16, ragged rows and duplicate headers.
- **Files modified:** `lib/ingestion/csv-windows.ts`, `lib/ingestion/__tests__/csv-windows.test.ts`
- **Verification:** all equivalence cases pass at window sizes 1, 3 and 50,000; the original emoji case (which failed) passes.
- **Committed in:** `13bba95`

**2. [Rule 1 - Bug] Reading Papa's stream with `for await` (research prototype) is two orders of magnitude too slow**
- **Found during:** Task 2 (the 140,809-row emoji test hit the test timeout; 300,000 rows measured 24 s)
- **Issue:** the async iterator drains one row per turn, pushing Papa into its pause/resume cycle on nearly every 16 rows (~1.3 ms each). A `parser.pause()` per window was still ~1 s per window.
- **Fix:** flowing mode with backpressure at the slice generator (next 1 MiB slice withheld while a finished window is unconsumed). 300,000 rows now take ~190 ms; the 986,000-row file processes in ~2 s end to end. Memory is still one window plus the slice being parsed.
- **Files modified:** `lib/ingestion/csv-windows.ts`
- **Verification:** csv-windows tests, and the 99 MiB bench above.
- **Committed in:** `13bba95`

**3. [Rule 3 - Blocking] Dependencies were absent in the worktree**
- **Found during:** setup
- **Issue:** no `node_modules` in the fresh worktree, so no test could run.
- **Fix:** `npm ci` (lockfile restore, no package added or changed). `package.json` and `package-lock.json` are unchanged.

**4. [Rule 1 - Bug] The bench's fake DB dominated the measurement**
- **Found during:** Task 3 verify (763 MB peak, over the 700 MB bound)
- **Fix:** compact numeric key hash in the fake (documented in the script). Real result: 550 MB at heap 600, 464 MB at heap 200.
- **Files modified:** `scripts/bench-ingest-memory.mts`
- **Committed in:** `da74dfe`

---

**Total deviations:** 4 auto-fixed (3 Rule 1, 1 Rule 3)
**Impact on plan:** Deviations 1 and 2 are corrections to the research prototype and are needed for the plan's own promise (results identical to whole-file processing). No scope creep; no fenced file touched.

## Issues Encountered

- A process hiccup, not a code issue: the first RED commit was made before the per-plan commit ledger file was written, so `plan_head_before` was recorded by hand from the known spawn base `419c925` (confirmed by `git log`); the measured count is 5.

## Known Stubs

None.

## Threat Flags

None. No new network endpoints, auth paths or schema changes. T-14-08..T-14-11 and T-14-SC mitigations are in place (slice bound proven by spy test; XLSX cap proven by test; equivalence at three window sizes; generator pre-window by default with accepted 0 asserted; lockfile diff empty).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 14-01 can call `claimFile` unchanged; an over-cap XLSX comes back as `unrecognised` with the cap reason in `rejectReasons`.
- 14-04 can import `MAX_XLSX_BYTES` and `XLSX_TOO_LARGE_REASON` from `lib/ingestion/xlsx-cap` into a client component (no imports in that module).
- 14-06 must take the deployed 99 MiB proof: the local numbers here are not Netlify numbers. Use `node scripts/gen-synthetic-billing.mjs --target-mib 99 --out FILE` (pre-window default: zero rows written to `billing_transactions`); never upload an `--in-window` file.
- The generated 99 MiB file is 103,975,097 bytes, under the 104,857,600 bucket limit.

## Self-Check: PASSED

- `lib/ingestion/xlsx-cap.ts`, `lib/ingestion/csv-windows.ts`, `lib/ingestion/__tests__/csv-windows.test.ts`, `scripts/gen-synthetic-billing.mjs`, `scripts/bench-ingest-memory.mts`: present.
- Commits `133765c`, `01e6416`, `aa3fcfa`, `13bba95`, `da74dfe`: present on HEAD.
- `npm test`: 972 passed / 52 files (baseline 926 / 51). `npm run lint`: 0 errors, 21 warnings (equal to baseline). `npx tsc --noEmit`: only the documented worktree `LayoutProps` artefact.
- Fence diff against `e55abda` over handlers, parsers, classify, normalise*, hash, file-date and `types.ts`: empty. `package.json` and `package-lock.json`: unchanged.
- No `@/` or `next/` imports in `csv-windows.ts` or `xlsx-cap.ts`; `grep -c "^import" lib/ingestion/xlsx-cap.ts` prints 0.

---
*Phase: 14-storage-first-manual-upload*
*Completed: 2026-10-20*
