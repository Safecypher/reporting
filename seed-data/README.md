# seed-data/

Drop historical daily verification report CSVs here (13 Aug 2026 onward,
per the data window in `CLAUDE.md`) and run:

```bash
npm run seed
```

`npm run seed` runs `scripts/seed-historical.ts`, which ingests every `*.csv`
file in this directory through the **exact same** `ingest()` pipeline the
live `/uploads` page uses (D-07) — no separate parsing/dedup logic. Because
de-duplication is enforced by the sha256 dup-file check plus the DB
`row_hash` UNIQUE constraint, re-running `npm run seed` after adding more
files (or after re-adding the same file) is safe and idempotent: already-seen
files are skipped, and only genuinely new rows are inserted.

## Current status (pending files from Richard)

Only `daily-ver-report_2026-08-13.csv` is on hand as of this plan's
execution. The full historical set (13 Aug 2026 onward) is still pending
from Richard. Seeding with a single day's file means the
verifications-over-time chart will look sparse (one data point) — chase the
remaining files before the demo to Mark for a convincing multi-day trend.

## `uploaded_by` attribution

`ingested_files.uploaded_by` is a foreign key to `auth.users(id)`. There is
no interactive session in a script context, so the seed script does **not**
fabricate a random uuid (that would violate the FK). Instead:

- Set the `SEED_UPLOADED_BY` environment variable to a real, already-seeded
  Supabase Auth user id (e.g. one of the internal team accounts) before
  running `npm run seed`, so the audit trail attributes seeded rows to a
  real account, e.g.:

  ```bash
  SEED_UPLOADED_BY=<real-auth-user-uuid> npm run seed
  ```

- If `SEED_UPLOADED_BY` is unset, the seed proceeds anyway and records
  `uploaded_by = null` for seeded `ingested_files` rows (the column is
  nullable) — a warning is printed so this isn't silent.

## Do not commit real report data

`seed-data/*.csv` is gitignored — verification reports contain card
references and other data that should not be committed to the repository.
Only this README is tracked in the drop directory. If you accidentally
`git add` a CSV here, unstage it before committing.
