---
status: resolved
trigger: "the TSYS (Safecypher Stats XX10.xlsx) files have all been failing recently wit the message \"Unrecognised file. This doesn't match any known report type — check you're uploading the daily verification report (CSV or XLSX).\" Here are a couple of recent examples (which look right to me). /Users/markwright/Downloads/Safecypher\\ Stats\\ 1610\\ to\\ 1710.xlsx /Users/markwright/Downloads/Safecypher\\ Stats\\ 1810\\ to\\ 1910.xlsx /Users/markwright/Downloads/Safecypher\\ Stats\\ 1710\\ to\\ 1810.xlsx"
created: 2026-10-19
updated: 2026-10-19
---

# Debug: TSYS Safecypher Stats .xlsx rejected as "Unrecognised file"

## Symptoms

- **Expected:** Uploading a TSYS "Safecypher Stats DDMM to DDMM.xlsx" file is classified as the TSYS APIGEE Calls report and ingested.
- **Actual:** Upload is rejected by classification before ingestion.
- **Error:** "Unrecognised file. This doesn't match any known report type — check you're uploading the daily verification report (CSV or XLSX)."
- **Timeline:** User reports the "0810 to 0910" file as the first one to fail; every Stats file since has failed. September Stats files (~11–12KB) worked. Observation: files in ~/Downloads jumped from ~11KB (Sept) to 2–4MB (12 Oct onward) — possible change in workbook format/content from TSYS.
- **Reproduction:** Upload any of these via the app's upload flow:
  - /Users/markwright/Downloads/Safecypher Stats 1610 to 1710.xlsx (4.17MB)
  - /Users/markwright/Downloads/Safecypher Stats 1710 to 1810.xlsx (3.50MB)
  - /Users/markwright/Downloads/Safecypher Stats 1810 to 1910.xlsx (3.32MB)
  - Known-good comparison: /Users/markwright/Downloads/Safecypher Stats 1809 to 2109.xlsx (12.5KB, Sept)

## Current Focus

- status: CONFIRMED (reproduced against real code + real files)
- hypothesis: TSYS added a 4th column `trace_id` to the "APIGEE Calls" sheet (from the 0710-0810 file onward). `apigeeStatsHandler.classify` calls `matchesHeader(header, ["Time","what_proxy_pathsuffix","response_code"])`, which requires `normalised.length === expected.length` (exact 3 columns), so a 4-column header classifies as null -> "Unrecognised file".
- bug_class: Bohrbug (deterministic, header-shape dependent)
- reasoning_checkpoint:
    hypothesis: "A trailing `trace_id` column in row 1 of the APIGEE Calls sheet makes apigeeStatsHandler.classify return false, because matchesHeader() demands header length === 3."
    confirming_evidence:
      - "Real claimFile() on 5 real 4-col files -> unrecognised; on 3 real 3-col files (incl. a 1.4MB/60k-row one) -> claimed apigee-stats"
      - "ExcelJS row-1 header of failing files is exactly [Time, what_proxy_pathsuffix, response_code, trace_id]; sheet name unchanged"
    falsification_test: "After the fix, the same 5 real files must classify as apigee-stats AND the 3-col files must still classify; if any 4-col file still fails, or any non-APIGEE shape starts matching, the hypothesis/fix is wrong."
    fix_rationale: "Classification is the only gate that rejects the file; the parser already reads cells 1-3 by position and is indifferent to column D. Fix the handler's header check (not the shared matchesHeader, which CSV handlers rely on being exact) to accept the 3-col header OR the 3-col header followed by exactly `trace_id`."
    blind_spots: "Haven't yet run parse/normalise/upsert on the 4-col files (will do after fix with fake deps); production (Netlify) memory/time on 80k-row files is not testable here; whole-row-hash dedup may collapse same-ms rows (adjacent, to be measured)."
    candidate_causes:
      - "code: strict header-length match rejects added column (CONFIRMED)"
      - "data/environment: 2-4MB size causing load failure swallowed by catch (ELIMINATED: 1.4MB 3-col file fine, 4-col files load in 0.5s)"
      - "config: sheet renamed/reordered (ELIMINATED: single sheet 'APIGEE Calls')"
    and_gate: "no - the single condition (4th header cell present) is sufficient and necessary; 3-col files of any size pass."
- next_action: awaiting human verification - user uploads a real 4-col Stats file (e.g. 1610 to 1710) in the app (local `npm run dev`, or after the fix is committed + pushed to origin/main for Netlify)
- note: files under ~/Downloads are real TSYS data — read them, never modify or commit them; don't copy them into the repo

## Evidence

- timestamp: 2026-10-19
  checked: unzip of workbook.xml / sheet1.xml / sharedStrings.xml header of every ~/Downloads "Safecypher Stats *.xlsx" (extracted to scratchpad, read-only)
  found: Single sheet "APIGEE Calls" in every file (sheet name unchanged, no tab-order issue). Every file from "0710 to 0810" onward has `<dimension ref="A1:D...">` and row 1 = Time, what_proxy_pathsuffix, response_code, trace_id (4 columns). Every file up to "0610 to 0710" and all the Sept files are `A1:C...` with exactly 3 columns. Column D values look like AWS X-Ray trace ids ("1-6ac7cba7-...") and Verify correlation ids.
  implication: the structural change that coincides with failures is a new trailing column `trace_id`. File size jump is explained by the extra high-cardinality string column (sharedStrings grows) plus a ~1000x row count (Sept ~10-100 rows; Oct 40-80k rows) — not a format change.
- timestamp: 2026-10-19
  checked: lib/ingestion/handlers/apigee-stats.ts + lib/ingestion/classify.ts matchesHeader + lib/ingestion/index.ts extractHeaderSignature
  found: classify() = sheetNames.includes("APIGEE Calls") && matchesHeader(header, APIGEE_HEADER); matchesHeader requires `normalised.length === expected.length` and positional equality. extractHeaderSignature pushes every non-empty row-1 cell, so a 4-column header yields length 4 != 3. The parser (parsers/apigee-stats.ts) only reads cells 1-3 by position, so it is already indifferent to a 4th column.
  implication: matches hypothesis mechanically; fix belongs in classification (and parser already safe). Still to confirm by running real code.

- timestamp: 2026-10-19
  checked: ran the REAL `claimFile()` (lib/ingestion/index.ts) with in-memory fake IngestDeps over real files (scratchpad helper repro-classify.ts, read-only)
  found: 1809 to 2109 (3-col, 12KB) -> claimed apigee-stats; 3009 to 0110 (3-col, 274KB, 11.7k rows) -> claimed; 0610 to 0710 (3-col, 1.4MB, 60k rows) -> claimed; 0710 to 0810, 0810 to 0910, 1610 to 1710, 1710 to 1810, 1810 to 1910 (all 4-col) -> kind=unrecognised. Classification takes 0.5-0.7s on the 3-4MB files, so it is not a load/timeout failure being swallowed by the catch in claimFile.
  implication: size is NOT the cause (a 1.4MB / 60k-row 3-col file classifies fine); the 4th column is. Reproduced deterministically.
- timestamp: 2026-10-19
  checked: ExcelJS row-1 header of 1809 (good), 0710-0810 and 1610-1710 (bad), JSON-quoted (scratchpad dump-header.ts)
  found: good = ["Time","what_proxy_pathsuffix","response_code"]; bad = ["Time","what_proxy_pathsuffix","response_code","trace_id"]. No stray whitespace/BOM; sheet name still exactly "APIGEE Calls"; single sheet.
  implication: the ONLY delta is the extra trailing trace_id column. Timeline correction: the first 4-col file by content is "0710 to 0810" (downloaded 8 Oct), not "0810 to 0910" — user may not have tried 0710-0810; every 4-col file fails regardless.
- timestamp: 2026-10-19
  checked: supabase/migrations/0010_apigee_stats.sql row_hash definition
  found: row_hash = md5(raw_event_time || raw_path_suffix || response_code::text); trace_id not part of it, so calls with the same ms timestamp + path + code collapse to one row. (adjacent finding, not the cause of this bug; to be measured separately after the fix)
  implication: do not change the schema as part of this fix; flag it.

- timestamp: 2026-10-19
  checked: RED -> GREEN on new tests; full suite; tsc; eslint; real-file replay through real claimFile+processClaimedFile with fake deps
  found: before fix 2 new positive tests failed (4-col header not classified; 4-col workbook ingest -> reportType null). After fix: vitest 51 files / 926 tests pass, tsc --noEmit clean, eslint clean. Replay of 12 real Stats files (3-col 1809, 0610 and 4-col 0710..1910 incl. the 3 the user named) -> all claimed as apigee-stats, accepted = sheet rows - 1 exactly, rejected 0, excluded 0; 82k-row/4MB file: claim 0.7s + process 0.75s, peak RSS ~815MB for the whole 12-file run in one process.
  implication: fix works on the real inputs; parser/normaliser already handled the 4th column.
- timestamp: 2026-10-19
  checked: aggregate collision count on real files (scratchpad measure-collisions.ts, counts only): rows sharing (raw_event_time, path, response_code) = the DB row_hash key
  found: 1610 to 1710: 81951 rows -> 74850 distinct keys (7101 = 8.7% collapse); 1810 to 1910: 65074 -> 59893 (8.0%); even the 3-col 0610 to 0710: 60844 -> 56452 (7.2%). All collisions are /Verify and /activateCardEntity (paths with no card reference); cvv-fetch and mostly unenrol are lossless. Adding trace_id makes every row distinct (81951/81951; 65074/65074 for time+path+code+trace_id).
  implication: ADJACENT PRE-EXISTING DEFECT, not this bug and independent of trace_id: once these files are accepted, ~7-9% of each large file's verify/enrol call events will be silently collapsed by apigee_calls.row_hash (reported as "duplicates"). Same class as the billing transactionId todo. Not fixed here (needs a migration + backfill decision); flagged to the caller.

## Eliminated

- hypothesis: file size / ExcelJS load failure on 2-4MB workbooks is swallowed by `claimFile`'s catch and yields the empty csv signature
  evidence: 60k-row 1.4MB 3-col file classifies fine; the 4-col files load in ~0.5s and the header read back is intact (4 cells).
  timestamp: 2026-10-19
- hypothesis: sheet renamed / sheet order changed / multi-sheet change
  evidence: every file has a single sheet named exactly "APIGEE Calls".
  timestamp: 2026-10-19

## Resolution

root_cause: TSYS began appending a fourth column `trace_id` to the "APIGEE Calls" sheet from the "Safecypher Stats 0710 to 0810" export onward (every 4-col file fails; every 3-col file, regardless of size, passes). `apigeeStatsHandler.classify` used `matchesHeader(header, ["Time","what_proxy_pathsuffix","response_code"])`, which requires header length === 3, so classification returned null and `claimFile` reported "Unrecognised file". File size (11KB -> 2-4MB) is a red herring: it is ~1000x more rows (10-100 -> 40-80k) plus the extra high-cardinality column, not a format change.
fix: in lib/ingestion/handlers/apigee-stats.ts add `matchesApigeeHeader()` accepting the original 3-column header OR the same three columns followed by exactly `trace_id`; classify() uses it. Shared `matchesHeader` (used by CSV handlers) untouched. Parser untouched (reads cells 1-3 by position; trace_id is not stored). Unknown 4th column / 5th column / trace_id not last / reordered columns remain unrecognised.
files_changed:
  - lib/ingestion/handlers/apigee-stats.ts
  - lib/ingestion/__tests__/apigee-stats.test.ts
oracle_type: derived (observed structure of real TSYS exports) + metamorphic (same data with/without the trace_id column ingests identically)
verification:
  target_test: { result: pass }   # 2 new positive tests RED before fix, GREEN after; boundary-neighbour test pins the rejects
  mutation_check: { result: pass, mutant_killed: true, note: "Stryker not configured; manual mutant (accept any trailing columns via slice(0,3)) killed by the boundary-neighbour test" }
  no_op_deletion: { result: pass, deletion_justified_by_rca: n/a }   # additive change, no behaviour removed
  adjacent_tests: { result: pass, suites_run: ["vitest run: 51 files / 926 tests", "tsc --noEmit", "eslint on changed files"] }
  revert_and_reconfirm: { result: pass, bug_returned_on_revert: true, fixed_on_reapply: true, note: "pre-fix: real claimFile on 5 real 4-col files -> unrecognised and new tests RED; post-fix: all claimed. Done by comparing pre/post states without git stash." }
  guardrail_verdict: accepted
  human_verify: { result: pass, note: "user uploaded a real 4-col Stats file on the deployed site (cebf236), 2026-10-19" }
