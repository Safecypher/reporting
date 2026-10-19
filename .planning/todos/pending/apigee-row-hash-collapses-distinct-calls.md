---
title: APIGEE row_hash collapses distinct calls — ~7-9% of each large Stats file counted as duplicates
created: 2026-10-19
severity: high
area: ingestion
discovered_in: debug session tsys-stats-xlsx-unrecognised (adjacent finding)
resolves_phase:
---

## What is wrong

`apigee_calls.row_hash` is `md5(raw_event_time || raw_path_suffix || response_code::text)`
(`supabase/migrations/0010_apigee_stats.sql`). Separate calls with the same millisecond
timestamp, path and response code hash identically, so all but one are dropped on upsert
and reported as `rows_duplicate`.

Since the Sept files had only 10-100 rows this was invisible. The October exports carry
40-80k rows, and the collapse is now material.

## Evidence (real files, measured 2026-10-19, counts only)

| File | Rows | Distinct (time+path+code) | Collapsed |
|---|---|---|---|
| Safecypher Stats 1610 to 1710 | 81,951 | 74,850 | 7,101 (8.7%) |
| Safecypher Stats 1810 to 1910 | 65,074 | 59,893 | 5,181 (8.0%) |
| Safecypher Stats 0610 to 0710 (3-col) | 60,844 | 56,452 | 4,392 (7.2%) |

All collisions are `/Verify` and `/activateCardEntity` (paths with no card reference);
cvv-fetch is lossless. Adding `trace_id` (the 4th column TSYS added from the 0710-0810
export, accepted but not stored since commit cebf236) makes every row distinct:
81,951/81,951 and 65,074/65,074.

The 0610 to 0710 figure shows this predates `trace_id`: 3-column files collapse too,
and they have no column that disambiguates them.

## Why it is not a one-line change

- Needs a migration: store `trace_id` and redefine `row_hash` (generated column) to
  include it. Files without `trace_id` (everything before 0710-0810) still have no way
  to tell same-ms calls apart — decide whether those keep the old key.
- Backfill decision: already-ingested Oct files under-count; re-ingest after the key
  changes? Re-uploading hits the `status = 'done'` content-hash de-dup, so a
  re-process path is needed.
- The APIGEE cross-check views (0020 onward) count `apigee_calls` rows; their figures
  will move once collapsed rows come back. Check what they compare against.

Same class as `billing-transaction-id-is-not-unique.md`: a dedup key that is not a
natural key, with the loss absorbed silently by `rows_duplicate`.
