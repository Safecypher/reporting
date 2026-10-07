---
title: billing transactionId is reused for different transactions — the unique index silently drops ~3.8% of every file
created: 2026-10-07
severity: critical
area: ingestion
discovered_in: Phase 13 close-out, diffing the 06/07 Oct billing files
resolves_phase:
---

## The finding

`transactionId` is NOT unique in the TSYS billing report. It is reused for genuinely
different transactions. Measured directly against
`~/Downloads/billing-report_2026-10-07.csv` on 2026-10-07:

| | |
|---|---|
| rows in file | 97,636 |
| distinct `transactionId` | 93,951 |
| ids appearing more than once | 3,602 (7,287 rows) |
| of those, EXACT repeats | 25 |
| of those, genuinely DIFFERENT transactions | **3,577** |
| differing rows that disagree on `authorised` | 1,067 |
| **rows unstorable under the current unique index** | **3,685 (3.8%)** |

Worked example, three rows sharing one id:

```
transactionId 425126
  date=2026-10-01 time=02:00:41 auth=True  kind=DCVV token=525346PLrLyz1313
  date=2026-10-06 time=15:48:31 auth=True  kind=DCVV token=546804ZwDnmm2765
  date=2026-10-06 time=20:13:29 auth=False kind=DCVV token=525346NTNkVW5148
```

Different days, different tokens, different authorisation outcomes.

## Why it is critical

`billing_transactions` declares `UNIQUE (transaction_id)`
(`billing_transactions_transaction_id_key`) and `lib/ingestion/handlers/billing.ts`
writes with `onConflict: "transaction_id", ignoreDuplicates: true`. Every colliding row
is discarded unread and counted as a duplicate, so the loss is invisible in
`rows_accepted` / `rows_duplicate`.

Billing is therefore structurally UNDERCOUNTED whenever ingestion is working — and the
dropped rows are not random: 1,067 of them disagree with the kept row about `authorised`.
This strikes the project's stated core value ("billing must equal verifications") and
makes every reconciliation figure computed to date suspect.

## Ordering constraint — do not fix the upload cap first

See [[billing-report-outgrew-the-5mb-upload-cap]]. Today the 5MB cap means no billing
data lands at all. Lifting it first would ingest a ~97,000-row backlog with a 3.8% silent
loss baked in, and it would LOOK like success because `rows_duplicate` absorbs it exactly
as it does now. That replaces "no billing data" with "billing data that is quietly wrong",
which is harder to detect and worse for a reconciliation tool.

**Settle the dedup key before the backlog lands.**

## Toward a fix

- The sibling high-volume tables already avoid this: `apigee_calls` dedups on a `row_hash`,
  not on a source-supplied id. Each distinct billing transaction here carries a distinct
  `(timestamp, tokenReference)` pair, so a whole-row hash would separate them correctly and
  matches existing practice.
- Needs a migration (drop/replace the unique index, add the hash column), a change to
  `handlers/billing.ts`, and a decision about the 24,566 rows already stored — are they
  re-derivable by re-ingesting retained files from Storage?
- Interacts with WR-02 (see [[phase2-open-data-source-confirmations]]): a row hash makes a
  genuine restatement look like a NEW row rather than a correction. Decide both together.

## Caveat on an earlier number

A first pass reported "1,134 shared ids changed between the 06 and 07 Oct files". That
figure is CONFOUNDED — the script kept one arbitrary occurrence per id, and ids repeat
within each file, so it compared arbitrary pairs. Do not rely on it. The intra-file
analysis above is sound because it compares every occurrence. WR-02 remains genuinely
open and unanswered by this work.

## Reproduce

Scripts used are throwaway; the analysis is one pass over each CSV grouping by
`transactionId` and comparing all occurrences field-by-field. Files measured:
`billing-report_2026-10-06.csv` (7.7MB, 78,270 rows, 75,892 distinct ids) and
`billing-report_2026-10-07.csv` (9.6MB, 97,636 rows, 93,951 distinct ids).
