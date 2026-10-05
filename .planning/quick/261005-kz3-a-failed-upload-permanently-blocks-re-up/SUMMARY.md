---
quick_id: 261005-kz3
slug: a-failed-upload-permanently-blocks-re-up
date: 2026-10-05
status: complete
files_modified:
  - lib/ingestion/supabase-writer.ts
  - lib/ingestion/__tests__/supabase-writer.test.ts
  - lib/ingestion/__tests__/chunking.test.ts
  - lib/push/__tests__/spine.test.ts
commits:
  - ec8e71b
---

# Summary — a failed upload no longer blocks its own retry

## Found while verifying the chunking fix

The chunking fix (quick-261005-fd9) deployed, the user re-uploaded, and the app
said: *"This file appears to have already been uploaded on 5 Oct 2026 at 10:53.
Re-uploading won't change any totals."* It had not been uploaded. It had failed.

`findFileByHash` matched on `content_sha256` alone, with no status filter. A run
that dies after `recordFile` but before `finalizeFile` leaves the row at
`pending` — and the unfiltered lookup reported that half-written attempt as a
prior successful upload. The file could then never be retried.

**Five rows were stranded in production**, each permanently blocking the file
that created it:

| File | Stranded |
|---|---|
| Safecypher Stats 0310 to 0410.xlsx | 5 Oct |
| Safecypher Stats 0210 to 0310.xlsx | 5 Oct |
| Safecypher Stats 0410 to 0510.xlsx | 5 Oct |
| card-inventory-report_2026-10-05.csv | 5 Oct |
| **Safecypher Stats 0110 to 0210.xlsx** | **2 Oct — unnoticed for three days** |

That last one is the uncomfortable part: this had already been happening, silently,
and the only reason it surfaced was that today's failures were loud enough to
investigate.

## Verified before touching anything

No partial data landed: `apigee_calls` still held exactly 28,998 rows and no
`card_inventory` row traced to a pending file. The old unbatched upsert was
all-or-nothing, and it was nothing. So the stranded rows are inert placeholders.

## The fix — no production DELETE

- `findFileByHash` filters `status = 'done'`. Only a COMPLETED ingest counts as
  already-uploaded; `pending` and `failed` fall through to a real attempt.
  Re-running is safe because every report table de-dups on its own
  `row_hash`/UNIQUE constraint — that is the real guarantee, and this lookup is
  only a short-circuit to avoid redundant work.
- `recordFile` upserts on `content_sha256` rather than inserting.
  `ingested_files` has `UNIQUE (content_sha256)`, so a retry would otherwise hit
  the constraint against the row the dead attempt left behind. Upserting reuses
  it and resets it to `pending`.

Net effect: **the five stranded rows heal themselves on the next upload.** No
manual deletion, nothing removed from production.

It cannot resurrect a completed ingest — `findFileByHash` short-circuits anything
at `done` before `recordFile` is reached.

## Three test fakes had to change

They stubbed the old shapes — a single `.eq()`, `.insert()`, and
`.upsert().select()`. The spine fake now models `status` properly, because its
de-dup assertion depends on the real sequence: a file only short-circuits a later
identical one once `finalizeFile` has marked it `done`. Updated to the new
contract, not worked around.

## Verification

- `npx tsc --noEmit` clean; `npm run build` clean
- eslint: **19 warnings before and after** — measured by stashing the change, not
  assumed
- `npm test` — **761 -> 766 tests**

## Not addressed

The task raised whether a `pending` row should be visually distinguished in the
upload history, since five sat unnoticed. It is not done here. The history does
show `Pending` as a status badge — the gap is that nothing draws attention to a
row that has been pending for days, which is a monitoring question rather than a
display one, and overlaps with Phase 10's freshness work. Worth a todo rather
than a rushed addition.
