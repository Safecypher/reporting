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
has grown past 5MB. The current file is ~8.1MB and is refused immediately in the
browser, before any request is made.

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

Netlify's synchronous function request payload ceiling sits not far above 5MB (bodies
are base64-encoded in transit, which inflates them) and is the likely original reason
for the number. **Confirm the exact current limit against Netlify's documentation
before designing anything.** If it holds, no constant value makes an 8.1MB upload work
through `/api/ingest` — it needs a direct-to-Storage signed upload from the browser,
bypassing the function. Phase 13's async work does not help: it moved processing off
the request, but the bytes still travel through the route handler.

Raising the constant alone would turn a clear client-side refusal into a confusing
mid-upload failure.

## Immediate data gap

Separate from the permanent fix: 2026-10-03..2026-10-06 billing figures still need to
be ingested so reconciliation is current.
