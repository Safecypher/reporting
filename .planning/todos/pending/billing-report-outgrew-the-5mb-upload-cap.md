---
title: Billing report outgrew the 5MB upload cap — billing data silently missing since 2 Oct
created: 2026-10-07
severity: high
area: ingestion
discovered_in: 13-05 Task 3 (deploy probe)
resolves_phase:
---

## What is wrong

`MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024` in `app/api/ingest/route.ts` (mirrored
client-side in `lib/upload/batch.ts`) rejects the cumulative billing report, which
has grown past 5MB. The current file is ~8.1MB and is rejected SERVER-SIDE with a 413, by the
handler's Content-Length check, before the body is buffered. Observed in the
browser console on 2026-10-07:

    Failed to load resource: the server responded with a status of 413 ()
    https://screporting.netlify.app/api/ingest

`describeIngestFailure(413)` then renders "File too large. Report files should be
at most a few MB." The client-side guard in `lib/upload/batch.ts` mirrors the
message, not the refusal.

## Evidence (live database, 2026-10-07)

Every report type is current to 2026-10-06 except billing, which stops at 2026-10-02:

| report_type | files | latest_upload | total_rows |
|---|---|---|---|
| apigee-stats | 33 | 2026-10-06 | 278,265 |
| card-inventory | 25 | 2026-10-06 | 162,302 |
| dcvv | 34 | 2026-10-06 | 88,936 |
| removed-cards | 13 | 2026-10-06 | 4,619 |
| verification | 38 | 2026-10-06 | 55,934 |
| **billing** | **41** | **2026-10-02** | **24,566** |

Last billing file ingested: `billing-report_2026-10-02.csv`, 19,828 rows accepted.
2026-10-03 through 2026-10-06 are missing.

## Why it matters

This is the project's core value — billing must equal verifications — and
reconciliation cannot be checked for those days. It is also exactly the failure class
milestone v1.1 ("Nothing Silently Missing") exists to eliminate, and it is invisible
to every surface: the refusal is client-side, so the server's 413 path and the
stuck-pending surfaces added in 13-04 are never reached.

## Why it is not a one-line change

The cap dates to Phase 01 (`feat(01-05)`, hardened as WR-02 in that phase's code
review) as a resource-exhaustion defence, with the comment "A few MB is more than any
daily report batch needs (T-05-01)". The cumulative billing report falsified that
assumption.

Netlify's synchronous function request payload ceiling sits somewhere above 5MB
(bodies are base64-encoded in transit, which inflates them) and is the likely original
reason for the number. **Confirm the exact current limit against Netlify's
documentation before designing anything.**

Evidence that bears on this, gathered 2026-10-07: the 8.1MB request REACHED our route
handler — the 413 came from our own Content-Length check, not from the platform. So
the platform did not refuse the request outright at that size. That is a point in
favour of simply raising the cap, and against the assumption that only a
direct-to-Storage signed upload can work. It is not conclusive: a Content-Length
header is read before the body is transferred, so the platform may still refuse the
full 8.1MB body once it actually streams. Test with the cap raised before concluding
either way.

If the platform limit does bite, the fallback is a direct-to-Storage signed upload
from the browser, bypassing the function entirely. Phase 13's async work does not help
either way: it moved processing off the request, but the bytes still travel through
the route handler.

## BLOCKED BY A MORE SERIOUS DEFECT — read first

`billing-transaction-id-is-not-unique.md` (added 2026-10-07, severity critical).
`transactionId` is reused for genuinely different transactions, and the
`UNIQUE (transaction_id)` index plus `ignoreDuplicates: true` silently discards ~3.8% of
every billing file — 3,685 rows in the 07 Oct file alone, of which 1,067 disagree with the
kept row about `authorised`.

**Do not lift the cap before the dedup key is settled.** Lifting it first would ingest the
~97,000-row backlog with that 3.8% loss baked in, and it would look like success because
`rows_duplicate` absorbs it. That is strictly worse than the current state: billing data
that is quietly wrong is harder to notice than billing data that is absent.

## Immediate data gap

Separate from the permanent fix: 2026-10-03..2026-10-06 billing figures still need to
be ingested so reconciliation is current.

## Also approaching the cap: TSYS Stats .xlsx (added 2026-10-19)

The TSYS "Safecypher Stats" exports have grown from ~11KB (Sept) to 2-4MB (Oct): ~1000x
more rows plus the new `trace_id` column. "Safecypher Stats 1610 to 1710.xlsx" is 4.17MB,
83% of the cap. Any fix here should cover Stats files too, not only billing. Netlify
memory/time on an 80k-row workbook is untested (local replay: claim 0.7s + process 0.75s).

Same caution as above applies: `apigee-row-hash-collapses-distinct-calls.md` means
~7-9% of each large Stats file is already miscounted as duplicates.
