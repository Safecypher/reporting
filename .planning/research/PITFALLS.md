# Pitfalls Research

**Domain:** Financial/operational reconciliation dashboard ingesting heterogeneous CSV/XLSX reports, de-duplicating, and computing tiered revenue (card-verification billing must equal verifications)
**Researched:** 2026-08-18
**Confidence:** HIGH (core failure modes are well-established data-engineering/financial-reconciliation patterns; several verified directly against this project's own sample data and arithmetic)

> The core value of this product is *trustworthy revenue reconciliation*. Almost every pitfall
> below is a way the dashboard can silently show a **wrong money number** or a **false/ missed
> discrepancy** — the two outcomes that destroy trust in a reconciliation tool. A dashboard that
> is merely late is annoying; a dashboard that is confidently wrong is worse than no dashboard.

---

## Critical Pitfalls

### Pitfall 1: Double-counting the cumulative billing report on re-ingestion

**What goes wrong:**
The billing report is *cumulative* — it contains the full rolling month (7-day / month-to-date window) and is re-received every day. If it is ingested with append semantics, every transaction that appeared yesterday is inserted again today. Revenue inflates by roughly the size of the overlap window each day. Within a week the revenue figure — the single most important number in the product — is multiples of reality.

**Why it happens:**
Developers treat all six reports identically ("parse rows, insert rows"). Five of them are per-day snapshots where append is roughly correct; the billing report is not, and the difference is invisible until totals are cross-checked against a known-good figure.

**How to avoid:**
- De-duplicate billing on the natural key `transactionId` with an `INSERT ... ON CONFLICT (transaction_id) DO NOTHING` (or `DO UPDATE` if late-arriving fields can change). Enforce with a **unique constraint / unique index** at the database level, not just application logic — application-only de-dup fails under concurrent or retried uploads.
- Make idempotency a schema invariant: re-uploading the same billing file must leave row counts and revenue unchanged. This is a testable property.
- Treat "cumulative vs snapshot" as an explicit per-report-type attribute in the ingestion config, so the distinction is impossible to overlook.

**Warning signs:**
- Daily revenue trends upward in lockstep with ingestion count rather than verification count.
- Row count for a given calendar day increases each time a new file is uploaded.
- Total verifications (from verification report) and total billed (from billing report) diverge by a growing multiple.

**Phase to address:** Ingestion / normalisation & de-duplication phase (must be in place before any revenue view is trusted).

---

### Pitfall 2: De-duplicating rows that have no natural unique key (verification & dCVV reports)

**What goes wrong:**
Verification and dCVV rows have no transaction ID. A composite key is required. Get it too *narrow* and you silently drop legitimate distinct verifications (two genuine verifications of the same card in the same second on the same card become one → **under-count revenue and volume**). Get it too *wide* and re-ingested snapshots duplicate → over-count. Near-duplicate verification rows seconds apart (retries, cardholder re-attempts) are exactly the ambiguous case that a naive `(timestamp, cardRef)` key mishandles.

**Why it happens:**
There is genuinely no perfect key. A card can legitimately be verified twice in quick succession; that is indistinguishable from a duplicated export row using only card + coarse timestamp. The choice of composite is a *business decision about what "the same event" means*, not a purely technical one.

**How to avoid:**
- Define the composite key from all available discriminating fields: `(CreatedAt at full precision, ExternalCardReference, duration, Cvi2Value, Authenticated)`. Sub-second timestamp precision plus `duration` (a near-continuous value) makes accidental collisions of genuinely distinct events very unlikely.
- Preserve the raw source rows (append-only staging table) separately from the de-duplicated canonical table, so the de-dup rule can be re-run/re-tuned without re-uploading files. Never destroy the raw data during ingestion.
- Surface a "duplicates suppressed" count per upload so a human can sanity-check that de-dup is neither eating real rows nor letting dupes through.
- Confirm with the business (Joachim) whether two same-second verifications of one card are physically possible; if not, a looser key is safe and simpler.

**Warning signs:**
- Verification counts that are suspiciously round or lower than APIGEE `/Verify` hit counts from the Thesis stats cross-check.
- "Duplicates suppressed" count that is large on a first-ever upload of a file (implies the key is collapsing distinct events).

**Phase to address:** Ingestion / normalisation & de-duplication phase; revisit in reconciliation phase against the APIGEE cross-check.

---

### Pitfall 3: Reconciliation boundary bug — billing (6am) vs other reports (8am) same-day mismatch

**What goes wrong:**
The billing report runs at 6am; the verification, inventory and removed-cards reports run at 8am. A verification occurring between (say) 5am and 8am can land in one report's "day" and the other report's next "day". The dashboard flags a billing↔verification mismatch that is purely a **timing artifact**, not a real discrepancy. Because false alarms are the fastest way to destroy trust in a discrepancy tool, this bug directly attacks the core value.

**Why it happens:**
Reconciliation is naively done by grouping each source on its own "report date" or file date and comparing per-calendar-day totals. The two sources have different cutoffs, so their day-buckets don't align at the edges.

**How to avoid:**
- Reconcile on the **event timestamp** of each individual transaction, not on which file/report-day it arrived in. Match billing rows to verification rows on `transactionId`/token/card+timestamp, then compare, rather than comparing daily aggregate totals.
- If aggregate-level reconciliation is used for the PoC, define an explicit shared reconciliation window and treat transactions in the 6am–8am boundary zone as "pending / awaiting counterpart report" rather than "mismatch". Only escalate to a real discrepancy once both sources have had a chance to report the event.
- Add a tolerance/settling period: a same-day mismatch that resolves once the next day's report arrives is a timing artifact, not an error — distinguish "unresolved > N days" from "unresolved today".
- Note the project's own mitigation: Joachim is aligning delivery times. Do not build assuming 6am/8am is permanent, but do not depend on the alignment either.

**Warning signs:**
- Discrepancies cluster at the start/end of the day and self-heal the following day.
- Mismatch magnitude correlates with early-morning transaction volume.

**Phase to address:** Reconciliation & discrepancy-flagging phase. This is the single most important correctness design decision in that phase.

---

### Pitfall 4: Floating-point / rounding errors in tiered revenue calculation

**What goes wrong:**
Revenue = verifications × tiered rates (first 500k at rate X, next 250k at rate Y, …). Doing this in JavaScript floats accumulates representation error (`0.1 + 0.2 = 0.30000000000000004`, `0.07 × 3 = 0.21000000000000002`, verified in this environment). Worse, tier-boundary logic invites off-by-one and double-application bugs: is the 500,000th verification in tier 1 or tier 2? Is the tier applied to *marginal* units (correct — first 500k at X, next 250k at Y) or accidentally to *all* units at the highest reached tier (wrong, and materially larger)?

**Why it happens:**
IEEE-754 doubles cannot represent most decimal currency fractions exactly. And tiered/marginal pricing is genuinely fiddly — the naive `if total > 500000 then rate = Y` applies the higher-tier rate to the *entire* volume rather than only the marginal units.

**How to avoid:**
- Store and compute money in **integer minor units** (cents/pence) or use Postgres `NUMERIC(precision, scale)` for stored monetary columns — never `float`/`double`/`real`. Compute the tiered sum in integers where possible (verified: integer-cents tier math is exact).
- Implement tiers as **marginal/graduated** brackets explicitly: for each bracket, `units_in_bracket × bracket_rate`, summed. Unit-test with volumes exactly on boundaries (499,999 / 500,000 / 500,001; 750,000; 0).
- Round only once, at the final presentation/invoice step, with an explicit documented rounding rule (round half up / banker's rounding — pick and record which, because it must match the MSA/Thesis invoice).
- Keep pricing tiers configurable (already a requirement) but validate configs: brackets must be contiguous, non-overlapping, ascending — a gap or overlap in config silently mis-prices.

**Warning signs:**
- Revenue totals with long trailing decimals (`.30000000004`).
- Dashboard revenue disagrees with a hand-calculated figure by a small but nonzero amount → float error; by a large amount → tier logic applies wrong bracket to whole volume.

**Phase to address:** Revenue-view / pricing phase. Also schema phase (choose `NUMERIC` up front — migrating a money column type after data exists is painful).

---

### Pitfall 5: UTF-8 BOM corrupting the first column header

**What goes wrong:**
The sample CSVs have a UTF-8 BOM (`EF BB BF`). If the parser doesn't strip it, the first column's header becomes `"﻿timestamp"` instead of `"timestamp"`. Column lookups by name (`row["timestamp"]`) then return undefined for the *first* column of every file — often the timestamp or the ID. Ingestion appears to succeed (no crash) but the most important column is silently null.

**Why it happens:**
The BOM is invisible in most editors and previews. The failure is silent: the parser produces rows, the row just has a key that looks identical to the naked eye but isn't byte-identical.

**How to avoid:**
- Strip the BOM on read. PapaParse handles BOM when given the raw string with its default settings, but do not assume — explicitly test. For XLSX, SheetJS handles encoding, but CSV-via-XLSX-export paths can still carry a BOM.
- Normalise/trim header names on ingestion (strip `﻿`, trim whitespace, canonicalise case) into a known schema mapping, rather than trusting raw header strings.
- Add an ingestion assertion: every expected column must be present *after* header normalisation, or reject the file loudly.

**Warning signs:**
- First column of a report is entirely null/empty in the database despite the source file clearly containing values.
- Header string length is one greater than expected, or `JSON.stringify(header)` shows `﻿`.

**Phase to address:** Ingestion / parsing phase.

---

### Pitfall 6: Excel date serials ingested as raw floats instead of dates

**What goes wrong:**
The Thesis `.xlsx` stores dates as Excel serial numbers, e.g. `46247.25`. If read as a raw number, `46247.25` is stored as the number forty-six-thousand rather than a timestamp. Verified in this environment: serial `46247.0` = 2026-08-13 00:00, `46247.25` = 2026-08-13 06:00, `46247.5` = 2026-08-13 12:00 — the integer part is days since the Excel epoch (1899-12-30, which absorbs Excel's 1900 leap-year bug for all dates after Feb 1900), and the fractional part is time-of-day. Notably, **serial 46247 is exactly the project's 13-Aug-2026 data-start cutoff** — a useful sanity anchor.

**Why it happens:**
XLSX has no strict cell "type" for dates; a date is a number with a display format. Libraries can hand back the raw serial unless told to coerce, and different export tools use the 1900 vs 1904 date system.

**How to avoid:**
- Configure the XLSX parser to emit JS `Date`s (SheetJS `cellDates: true`), and verify the workbook's date system (1900 vs 1904 epoch) — getting the epoch wrong shifts every date by ~4 years / 1462 days.
- Add a range/sanity check: any parsed timestamp before 2026-08-13 or in the future is rejected/flagged (also catches the 1904-vs-1900 shift, which would push dates to ~2030 or ~2022).
- Handle both possibilities per column: some cells may arrive as serials, some as pre-formatted date strings, depending on how Chris exports. Normalise both to UTC timestamps at ingestion.

**Warning signs:**
- Timestamp columns containing 5-digit integers (~46000+).
- All dates off by exactly ~4 years or exactly 1462 days → 1900/1904 epoch mismatch.

**Phase to address:** Ingestion / parsing phase (XLSX path specifically).

---

### Pitfall 7: Mixed timezone handling (Z-suffixed UTC vs naive local timestamps)

**What goes wrong:**
Timestamps arrive in inconsistent forms: some `Z`-suffixed UTC, some naive/local with no offset. Infrastructure spans US-Central (Invex), Atlanta on-prem, and AWS US-East (Thesis). If naive timestamps are assumed UTC when they are actually local (or vice versa), events shift by hours. This directly re-triggers the boundary bug (Pitfall 3): a several-hour timezone error moves transactions across the day boundary, manufacturing billing↔verification mismatches, and it silently mis-buckets the 6am/8am report cutoffs.

**Why it happens:**
Naive timestamps are ambiguous by definition. `new Date("2026-08-13T06:00:00")` (no offset) is interpreted in the server's local zone, which in a serverless/hosted environment is usually UTC — but the data may have been emitted in US-Central or US-Eastern. The mistake is assuming a zone rather than establishing it per source.

**How to avoid:**
- Establish and **document the source timezone per report type** (confirm with Joachim/Chris) — do not guess. Convert everything to UTC at ingestion; store `timestamptz` in Postgres.
- Never let naive timestamps be parsed in the ambiguous "runtime local" zone — attach the known source offset explicitly before conversion.
- Store the original raw timestamp string alongside the normalised UTC value so the interpretation can be audited/re-done if the assumed zone turns out wrong.
- All day-bucketing for reconciliation and charts must be done in one explicit, chosen "business day" timezone (pick one — likely the deployment's operational zone — and record it), not in the viewer's browser zone.

**Warning signs:**
- Transaction counts shift by whole hours when comparing sources.
- Day-boundary discrepancies of a magnitude matching a fixed hour offset (e.g. 5 or 6 hours = US-Central/Eastern vs UTC).
- Charts render events on a different calendar day for different viewers.

**Phase to address:** Ingestion / normalisation phase (canonicalise to UTC); reconciliation phase (choose business-day zone).

---

### Pitfall 8: Idempotency failure on duplicate file upload

**What goes wrong:**
A user drags the same file in twice (double-click, retry after a slow upload, or re-sending yesterday's email attachment). Without file-level idempotency plus row-level de-dup, the second upload re-inserts (for snapshot reports) or re-accumulates (for cumulative billing) data. Manual drag-and-drop upload makes accidental re-uploads *likely*, not hypothetical.

**Why it happens:**
The happy path (one file, one upload) is what gets built and demoed. Re-upload is an operational reality that only surfaces in real use, by which point the numbers are already wrong and it's unclear which upload caused it.

**How to avoid:**
- Two layers of defence: (a) row-level unique constraints / composite keys (Pitfalls 1 & 2) make re-ingestion inherently idempotent; (b) record a content hash of each uploaded file and warn ("this file appears to have been uploaded already on ...") before processing.
- Keep an ingestion audit log: filename, hash, upload time, uploader, rows parsed, rows inserted, rows suppressed. This makes "why did the number change?" answerable.
- Make re-processing safe by design: ingestion should be re-runnable from raw staging without changing canonical totals.

**Warning signs:**
- Totals change without a genuinely new report period.
- Ingestion audit shows two entries with identical file hashes.

**Phase to address:** Ingestion phase (idempotency + audit log); depends on the de-dup constraints from Pitfalls 1 & 2.

---

### Pitfall 9: Ingesting known-bad / pre-cutoff data (Verify Outcome tab; pre-13-Aug data)

**What goes wrong:**
The Thesis `Verify Outcome` tab has a known Thesis-side data issue and must be ignored; data before 13-Aug-2026 is unreliable. If a parser blindly reads all tabs/rows, bad data enters the canonical store and pollutes every downstream metric and reconciliation — and it's hard to retract cleanly once mixed in.

**Why it happens:**
"Ingest the workbook" naturally reads every sheet; "ingest the file" naturally reads every row. The exclusions are business rules external to the file format, so they must be encoded deliberately.

**How to avoid:**
- Parse only the whitelisted sheet(s) — read `APIGEE Calls`, explicitly skip `Verify Outcome`. Whitelist by name, and fail loudly if an expected sheet is missing rather than silently falling back to another.
- Enforce the 13-Aug-2026 cutoff as a hard ingestion filter (`event_timestamp >= 2026-08-13`), applied after timezone normalisation (Pitfall 7), and log how many rows were dropped by the cutoff.
- Make both exclusions configurable/dated, so the `Verify Outcome` tab can be re-enabled when Thesis fixes it without a code change.

**Warning signs:**
- Metrics show activity before 13-Aug-2026.
- Response-code / outcome stats that don't reconcile with APIGEE call counts (a sign Verify Outcome data leaked in).

**Phase to address:** Ingestion / parsing phase.

---

### Pitfall 10: Card-inventory reconciliation drift (day-over-day diff vs removed cards)

**What goes wrong:**
Net live cards should reconcile: `inventory(today) − inventory(yesterday)` should equal `enrolled today − removed today`. If a day's inventory report is missed, uploaded out of order, or the day-over-day diff is computed against the wrong prior snapshot, the reconciliation drifts and never self-corrects. Compounded because Thesis/TSYS currently only sends *daily new enrolments*, not cumulative totals (chase in progress) — so a missing day leaves a permanent hole in the running tally.

**Why it happens:**
Snapshot-diff reconciliation assumes an unbroken daily sequence. Manual upload guarantees gaps and out-of-order arrivals will happen.

**How to avoid:**
- Compute inventory diffs against the *actual previous available snapshot date*, not "yesterday", and surface any gap in the daily sequence explicitly ("no inventory report for 15-Aug — reconciliation for 16-Aug spans 2 days").
- Reconcile cumulatively where possible; where only daily deltas exist, track a running total and flag when the sequence is incomplete rather than presenting a falsely precise number.
- Cross-check against APIGEE `activateCardEntity` (enrolment) and `/removeCards` (unenrolment) counts as an independent third source.

**Warning signs:**
- Inventory reconciliation error that grows monotonically (accumulating from one missed day).
- Net live cards diverging from the APIGEE-derived count.

**Phase to address:** Reconciliation phase; depends on ingestion tracking which report-days are present/absent.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Application-only de-dup (no DB unique constraint) | Faster to code | Duplicates slip in under retries/concurrency; corrupts revenue | Never for billing/verification — the whole product is correctness |
| Storing money as `float`/`real` | "It's just a number" | Rounding drift; type migration once data exists is painful | Never — use `NUMERIC` or integer minor units from day one |
| Not keeping raw staging data (parse straight into canonical tables) | Simpler schema | Can't re-run de-dup/timezone fixes without re-collecting files; no audit trail | Never — raw retention is cheap insurance for a reconciliation tool |
| Reconciling on report-day instead of event timestamp | Easy aggregation | Chronic false-positive boundary discrepancies (Pitfall 3) | Acceptable *only* for a throwaway PoC screenshot, with a visible "PoC — timing artifacts possible" caveat |
| Hardcoding pricing tiers in code | Ship revenue view faster | MSA numbers not yet received; every change is a deploy | Never — configurability is already a requirement |
| Assuming all timestamps are UTC | Skip timezone work | Hours-off bucketing → manufactured discrepancies | Never without confirming source zones |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Supabase Postgres | Relying on app logic for uniqueness | Unique constraints/indexes on natural + composite keys; `ON CONFLICT` upserts |
| Supabase Storage (uploaded files) | Treating upload success as ingestion success | Separate "file stored" from "file parsed & validated"; audit log with row counts |
| SheetJS (XLSX) | Reading serial numbers as raw floats; reading all sheets | `cellDates: true`, verify 1900/1904 epoch, whitelist sheets, skip `Verify Outcome` |
| PapaParse (CSV) | Assuming BOM is stripped; trusting header strings | Explicitly strip `﻿`, normalise headers, assert expected columns present |
| Thesis APIGEE stats | Treating as authoritative source of truth | Use as independent cross-check only; expect ad-hoc timing, Monday Fri–Sun catch-up |

## Performance Traps

At the stated scale (~70–80 transactions since restart; tiers denominated in hundreds of thousands) performance is **not** a near-term risk. Do not over-engineer. The realistic traps:

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Recomputing revenue/reconciliation on every dashboard load from raw rows | Slow dashboard as history grows | Pre-aggregate into daily rollup tables; index event-timestamp columns | Months–years of daily data, not an immediate concern |
| Row-by-row inserts during ingestion | Slow uploads | Batch insert / bulk upsert | Only matters once files are large |
| Cumulative billing report growing unbounded (rolling month re-sent) | De-dup scans grow | Index `transaction_id`; the rolling window bounds it naturally | Unlikely to bite at this scale |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| PAN/PII in reports treated as ordinary data | Card-verification data may contain sensitive references (card refs, issuer/processor, region) | Confirm no full PAN is present; `ExternalCardReference` is a token — keep it that way; restrict access to the internal team only |
| No RLS on Supabase tables | Any authenticated request could read/modify all financial data | Enable Row Level Security; even for an internal tool, lock tables to the authenticated internal team |
| Uploaded files world-readable in Storage | Billing/revenue data exposure | Private Storage bucket, authenticated access only, signed URLs if needed |
| Trusting client-side parsing of financial figures | Tampered/altered numbers reach the DB | Parse and validate server-side; the browser never computes canonical revenue |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Showing a discrepancy figure without saying whether it's a real error or a timing artifact | Leadership loses trust after chasing false alarms (kills core value) | Distinguish "unresolved today (pending counterpart report)" from "confirmed mismatch > N days"; show the settling window |
| Silent ingestion (no feedback on rows parsed/suppressed/rejected) | User can't tell if an upload actually worked or was a no-op de-dup | Post-upload summary: parsed / inserted / suppressed-as-duplicate / rejected, with reasons |
| Presenting revenue to false precision (many decimals) | Looks buggy / untrustworthy | Round to currency precision at display; state the rounding rule |
| No indication of missing report-days | User assumes data is complete when a day was never uploaded | Show a per-report ingestion calendar with gaps highlighted |
| Charts in viewer's browser timezone | Same event appears on different days for different people | Render all time buckets in one documented business-day zone |

## "Looks Done But Isn't" Checklist

- [ ] **Billing ingestion:** Re-upload the same billing file — revenue and row count must be unchanged (idempotency). Often missing: DB-level unique constraint on `transactionId`.
- [ ] **Verification de-dup:** Two genuinely distinct same-second verifications of one card — verify both survive. Often missing: a composite key that's too narrow silently drops one.
- [ ] **Revenue math:** Compute totals at tier boundaries (499,999 / 500,000 / 500,001) by hand and compare. Often missing: marginal-bracket logic (applies higher rate to whole volume instead of marginal units).
- [ ] **BOM:** Confirm the first column of every report is populated in the DB. Often missing: `﻿` stripping → first column silently null.
- [ ] **XLSX dates:** Confirm Thesis dates land as real 2026 timestamps, not ~46000 integers or ~2022/2030 dates. Often missing: `cellDates` + epoch check.
- [ ] **Timezone:** Confirm a 6am transaction from each source lands on the correct business day. Often missing: naive timestamps parsed in runtime-local zone.
- [ ] **Boundary reconciliation:** Feed a 6am–8am transaction and confirm it is *not* flagged as a permanent mismatch. Often missing: settling window / event-timestamp matching.
- [ ] **Cutoff:** Confirm no pre-13-Aug-2026 data and no `Verify Outcome` data reach the dashboard. Often missing: hard cutoff filter applied post-timezone-normalisation; sheet whitelist.
- [ ] **Missing-day handling:** Skip a day's inventory upload — confirm reconciliation flags the gap rather than silently drifting.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Double-counted billing (Pitfall 1) | LOW *if* raw staging retained | Truncate canonical billing table, re-run de-dup from raw staging with the unique constraint in place |
| Wrong de-dup composite key (Pitfall 2) | LOW–MEDIUM if raw retained | Re-derive canonical rows from raw staging with corrected key; no re-collection of files needed |
| Wrong timezone assumption (Pitfall 7) | LOW if raw timestamp strings retained | Re-normalise from stored raw strings with corrected source zone |
| Float/tier revenue error (Pitfall 4) | LOW | Recompute (revenue is derived, not source data) once math is fixed |
| Bad data ingested (Pitfall 9) | MEDIUM if not isolatable | Cheap if rows tagged by source file/sheet — delete by tag; expensive if mixed untagged into canonical tables |
| Inventory drift from missing day (Pitfall 10) | MEDIUM | Obtain the missing report and re-run the sequence; if unavailable, mark the tally as broken from that date |

**Meta-recovery principle:** Every recovery above is *cheap if raw source data and per-row source lineage are retained*, and *expensive or impossible if not*. Append-only raw staging + source lineage tags is the single highest-leverage insurance decision for this product.

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Cumulative billing double-count | Ingestion / de-dup | Re-upload billing file → totals unchanged |
| 2. No-natural-key de-dup | Ingestion / de-dup | Same-second distinct verifications both survive; suppressed-count sane |
| 3. 6am/8am boundary mismatch | Reconciliation | 6–8am transaction not flagged as permanent mismatch |
| 4. Float / tier revenue error | Schema (NUMERIC) + Revenue view | Hand-calc at tier boundaries matches |
| 5. UTF-8 BOM | Ingestion / parsing | First column populated for every report |
| 6. Excel date serials | Ingestion / parsing (XLSX) | Thesis dates are real 2026 timestamps |
| 7. Mixed timezones | Ingestion (→UTC) + Reconciliation (business-day zone) | 6am transaction lands on correct day for all viewers |
| 8. Duplicate file upload | Ingestion (idempotency + audit) | Duplicate upload warned + no total change |
| 9. Known-bad / pre-cutoff data | Ingestion / parsing | No pre-13-Aug or Verify Outcome data present |
| 10. Inventory reconciliation drift | Reconciliation (+ ingestion gap tracking) | Skipped day flagged, not silently absorbed |

**Roadmap implication:** de-dup and correctness cannot be a later "hardening" phase bolted on after the views. Pitfalls 1, 2, 4 (schema), 5, 6, 7 must be designed into the **ingestion/normalisation phase and the database schema**, because every downstream view inherits their correctness. The reconciliation/discrepancy phase depends on ingestion having already canonicalised timestamps to UTC and retained raw lineage. A PoC that shows views before de-dup is correct risks showing Mark confidently wrong revenue — the exact opposite of the product's core value.

## Sources

- Project context: `.planning/PROJECT.md` (report relationships, de-dup notes, 6am/8am timing, pricing tiers, cutoffs, known-bad data) — HIGH
- Direct verification in this environment: Excel serial `46247.xxx` → 2026-08-13 (matches data-start cutoff); JS float error `0.1+0.2` and `0.07*3`; integer-cents tier math exactness — HIGH
- Established data-engineering / financial-reconciliation domain knowledge: cumulative-vs-snapshot ingestion, composite-key de-dup ambiguity, event-time vs report-time reconciliation, marginal/graduated tier pricing, `NUMERIC`/minor-units for money, BOM header corruption, Excel 1900/1904 epoch and 1900-leap-year bug, naive-timestamp zone ambiguity — HIGH (well-established, stable)

---
*Pitfalls research for: card-verification reconciliation & revenue reporting dashboard*
*Researched: 2026-08-18*
</content>
</invoke>
