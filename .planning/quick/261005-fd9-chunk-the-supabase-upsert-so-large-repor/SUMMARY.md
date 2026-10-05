---
quick_id: 261005-fd9
slug: chunk-the-supabase-upsert-so-large-repor
date: 2026-10-05
status: complete
files_modified:
  - lib/ingestion/supabase-writer.ts
  - lib/ingestion/__tests__/chunking.test.ts (new)
  - lib/ingestion/__tests__/supabase-writer.test.ts
  - app/api/ingest/route.ts
commits:
  - a674853
---

# Summary — chunked report upserts

## Diagnosis, measured before changing anything

Three TSYS "Safecypher Stats" files failed on `/uploads`. Console showed 5x **504**
from `/api/ingest` (plus one 413, see below).

| Measured | Value |
|---|---|
| ExcelJS read | 240-370ms — **not** the bottleneck |
| Rows per file | 43,383 / 45,367 / 53,876 |
| `apigee_calls` total rows | 28,998 |
| Batching in `upsertRows` | none — one request for everything |
| `maxDuration` on `/api/ingest` | absent (drain route sets 60) |

One upload was roughly **1.6x the entire existing table**, sent as a single
PostgREST request, with `.select("id")` returning ~45,000 ids back purely so the
return value could be `data.length`.

Why now: earlier files were 0.10-0.33 MB, these are ~1 MB. Volume grew until the
unbatched write stopped fitting in the budget.

## What changed

- `chunkRows()` — 1000-row batches, exported and unit-tested.
- Both `upsertRows` AND `upsertVerifications` loop over batches.
  `upsertVerifications` had the identical unbatched shape and the same exposure;
  fixing only the one that happened to break would have left the other waiting.
- `count: "exact"` replaces `.select("id")`. Identical semantics — rows actually
  written, duplicates not counted under `ignoreDuplicates` — without the payload.
- `maxDuration = 60` on `/api/ingest`. Insurance, not the fix.

`push`/`drain` share this writer, so that path is fixed too.

## What was deliberately preserved

The de-dup contract. `onConflict` and `ignoreDuplicates` are forwarded on **every**
batch, not just the first — asserted, because that is exactly the kind of thing a
chunking refactor silently drops. The DB `row_hash` UNIQUE constraint remains the
real guarantee.

A failing batch **throws** rather than returning a count. Earlier batches stay
written, which is safe because `row_hash` makes a re-upload idempotent — the same
reasoning that already justifies `upsert: true` on the Storage write. What must
never happen is reporting success for a file that only partly landed.

## Two existing tests changed

`supabase-writer.test.ts` pinned the old `.upsert().select()` shape and failed. The
contract genuinely changed, so the fake and its assertions were updated to match —
not worked around.

## Verification

- `npx tsc --noEmit`, `npx eslint` (no new warnings), `npm run build` — clean
- `npm test` — **749 -> 761 tests**

## Still open

**The 413 is unexplained.** `/api/ingest` returns 413 only above 5MB and these files
are ~1MB, so that single occurrence came from elsewhere — possibly a Netlify edge
limit on a retry. It is one error among six and not the pattern. If uploads still
fail after this deploy, that is the thread to pull.

**Not yet proven against a real file.** The fix is verified by unit tests and
reasoning, not by re-uploading one of the three files. That is the actual test.
