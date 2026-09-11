# 06-09 Task 1 — orchestrator execution record

**Performed by:** orchestrator (Claude, `/gsd-execute-phase 6 --gaps-only`)
**When:** 2026-09-11
**Why not the executor:** executor subagents in this project have no Supabase MCP access, and
there is no `SUPABASE_ACCESS_TOKEN` in the executor environment. The `supabase` CLI is not
installed on this machine either (`which supabase` → not found), so the MCP `apply_migration`
path was the only one available.

## 1. Migrations applied

Applied in ascending order, each file whole, via Supabase MCP `apply_migration` against the
linked project `gditxlxfdwlvnyhhxybf`:

| Migration | Result |
|---|---|
| `0031_alignment_per_source_settling.sql` | `{"success": true}` |
| `0032_alignment_inventory_diff_rows.sql` | `{"success": true}` |
| `0033_baseline_as_of_on_offset_change.sql` | `{"success": true}` |

No statement errored, so the "stop and report the failing statement" branch was not taken.

### Pre-existing ledger discrepancy (noted, not caused by this work)

`list_migrations` shows the remote ledger jumping `0022 → 0027`: migrations `0023_app_settings`,
`0024_revenue_total_for_period`, `0025_pricing_tier_edit_in_place` and `0026_tsys_msa_tier_seed`
exist locally but are absent from the remote ledger, despite their objects being live (0029
alters `app_settings`, which 0023 creates, and it applied cleanly). They were most likely applied
via `execute_sql` rather than `apply_migration` in an earlier phase, which does not write a ledger
row. **This predates Phase 6 gap closure and was not introduced by it.** Flagged for follow-up.

## 2. Types regenerated

`types/db.ts` was regenerated from the **live schema** via MCP `generate_typescript_types`.

One deviation, recorded rather than silent: the MCP generator emits only the `public` schema,
while the committed `types/db.ts` also carries a `graphql_public` block (from the CLI generator
used previously). Overwriting wholesale would have silently dropped `graphql_public`. Instead the
live-derived deltas were applied surgically — each new shape copied verbatim from the MCP output —
leaving `graphql_public` intact. The four load-bearing symbols and their exact shapes come from
the live database, not from the migration text.

Deltas applied:
- `v_alignment_daily.Row` += `counterpart_max_day: string | null`, `tsys_max_day: string | null`
- `v_alignment_live_cards_daily.Row` += `bit_addict_max_day: string | null`, `tsys_max_day: string | null`
- `Functions` += `alignment_counterpart_max_day`, `alignment_inventory_diff_rows`, `alignment_settled`
- `alignment_live_cards_for_period.Returns` += `tsys_coverage_complete: boolean`

## 3. Task 1 verify commands

| Command | Result |
|---|---|
| `grep -cE 'tsys_coverage_complete\|counterpart_max_day\|bit_addict_max_day\|alignment_inventory_diff_rows' types/db.ts` | **5** (threshold: ≥4) — PASS |
| `grep -c '^do \$\$'` over the four oracles | truth-table **7**, live-cards **7**, inventory-diff **6**, baseline **4** (thresholds 7/7/6/4) — PASS, no oracle trimmed |
| `npx tsc --noEmit` | clean, no output — PASS |

## 4. Oracle runs (live)

**Method note, stated plainly:** the Supabase MCP `execute_sql` transport does **not** return
`NOTICE` output — a probe (`do $$ begin raise notice ...; end $$;`) returned an empty result set.
Each oracle's `DO` blocks were therefore executed live verbatim in their assertion logic, where
**a violation raises an exception and surfaces as an error**; a clean run is the pass signal. The
observed values the plan asks to be recorded were then obtained by directly querying the same
expressions the `NOTICE` lines interpolate. The values below are live query results, not
NOTICE text.

### `alignment_truth_table_test.sql` — 6 blocks, PASSED

Blocks A–F all executed without exception over **87 live `v_alignment_daily` rows**.

Block F observed per-source maxima:

| Source | Observed maximum |
|---|---|
| TSYS (`apigee_calls`) | **2026-08-13** |
| Inventory (`v_inventory_daily_diff`) | **2026-09-08** |
| Verification (`verifications`) | **2026-09-10** |

**The three do NOT coincide.** The two Bit Addict sources are genuinely 2 days apart
(09-08 vs 09-10) — the exact divergent-freshness condition CR-01 concerned. Under the old shared
bound, the merged `greatest(...)` would have been 2026-09-10 and would have been applied to
enrolled/unenrolled as well, whose true counterpart only reaches 2026-09-08.

### Does the CR-01 fix change any verdict on today's data? — **No, and here is why**

| metric | days | settled (new, per-metric bound) | settled (old, merged bound) | verdicts differing |
|---|---|---|---|---|
| enrolled | 29 | 0 | 0 | **0** |
| unenrolled | 29 | 0 | 0 | **0** |
| volume | 29 | 0 | 0 | **0** |

TSYS's maximum sits at the 2026-08-13 floor (only **3** `apigee_calls` rows in the whole window),
so the TSYS conjunct of `alignment_settled` is false for every day and short-circuits the result
regardless of which counterpart bound is used. The divergence is real but currently **masked** —
exactly the "latent rather than actively firing" state 06-VERIFICATION.md predicted. The fix's
correctness therefore rests on Block D's literal-argument cases and on
`alignment-settled.test.ts`, **not** on today's dataset. Recorded as an unexercised case rather
than as evidence of correctness.

### `alignment_live_cards_test.sql` — 6 blocks, PASSED

| Value | Observed |
|---|---|
| Block E — TSYS max (`apigee_calls`) | **2026-08-13** |
| Block E — Bit Addict max (`card_inventory`) | **2026-09-08** |
| Block F — `tsys_coverage_complete` | **false** |
| Block F — `coverage_complete` | **false** |
| Block F — `bit_addict_snapshot_day` | **2026-09-08** (non-null) |
| Block F — `settled` | false |
| Block F — `status` | `needs_review` |

CR-02 note: the two coverage signals are now **separable** and `tsys_coverage_complete` passes
through `coverage_complete_to_date` unmodified (Block F asserts this). However, on today's data
both happen to be `false`, so the *misattribution* case the fix exists to prevent — TSYS covered
while Bit Addict is the missing side — is **not exercised**. Recorded as unproven on live data.

### `alignment_inventory_diff_rows_test.sql` — 5 blocks, PASSED — **the strongest live evidence in this run**

| Value | Observed |
|---|---|
| Paired days in `v_inventory_daily_diff` | **5** (non-zero → Block A is discriminating, not vacuous) |
| Enrolled rows checked, drill vs aggregate | **4,417**, all matching exactly |
| Unenrolled rows checked, drill vs aggregate | **61**, all matching exactly |
| Unpaired days | **5**, each returning **zero** rows for both directions |

Block C was genuinely exercised (5 unpaired days, not 0): the pairing guard demonstrably returns
zero rows rather than a whole snapshot, which is the precise route by which WR-04 could have been
re-created. Block D confirmed an unrecognised direction (`'all'`, `''`) returns zero rows.
Block E confirmed no returned row has a null `file_name`, so the `From {file_name}` caption holds.

**WR-04 is proven closed on live data.** Under the old code the enrolled drill returned the whole
day's snapshot; it now returns exactly the 4,417 rows the aggregate counts.

### `baseline_as_of_trigger_test.sql` — 3 blocks, PASSED

Catalog-only. Confirmed `trg_app_settings_baseline_as_of` exists on `app_settings` as a
**BEFORE UPDATE row-level** trigger; the pre-existing `trg_app_settings_audit` is still an
**AFTER UPDATE row-level** trigger, untouched; and `fn_app_settings_baseline_as_of()` holds **no**
EXECUTE grant for `public`, `anon` or `authenticated`.

As the oracle itself states, this asserts wiring only, not runtime effect — proving the value
carries forward requires writing to `app_settings`, which the oracle deliberately does not do.

## 5. Security advisors

Two `WARN` findings, **neither attributable to 0031, 0032 or 0033**:

1. `authenticated_security_definer_function_executable` ×2 — `public.save_pricing_tier_set` and
   `public.delete_pricing_tier_set`, both `SECURITY DEFINER` and callable by `authenticated`.
   Pre-existing, from the Phase 3 pricing-tier work (0015/0016/0025).
2. `auth_leaked_password_protection` — HaveIBeenPwned checking disabled in Auth config.
   Unrelated to the database schema.

None of the five functions added by this gap closure — `alignment_settled`,
`alignment_counterpart_max_day`, `alignment_inventory_diff_rows`,
`alignment_live_cards_for_period`, `fn_app_settings_baseline_as_of` — appear in the report.
All are `security invoker` with `set search_path = public`. No new RLS-bypass, missing-RLS or
mutable-`search_path` warning was introduced.

## 6. Acceptance criteria

- [x] `types/db.ts` contains all four new symbols (grep count 5 ≥ 4)
- [x] All four oracles completed without raising an exception
- [x] Per-source maxima recorded **as values** (truth-table Block F, live-cards Block E) — not as a judgement
- [x] Paired-day count recorded (**5**, non-zero — so not a vacuous pass)
- [x] Advisor report shows no new warning attributable to 0031/0032/0033
- [x] Every oracle still carries its full block count — none trimmed or weakened

## 7. Honest limitations

1. **`NOTICE` text was not captured verbatim** because the MCP transport does not return it. The
   assertions ran live; the values were recovered by querying the same expressions. Stated here
   rather than presenting reconstructed values as NOTICE output.
2. **CR-01's fix is not exercised by today's data** — TSYS staleness masks the Bit Addict
   divergence, so zero verdicts differ. Correct-by-construction plus literal-argument oracle
   coverage, not live behavioural proof.
3. **CR-02's misattribution case is not exercised** — both coverage signals are currently `false`.
4. **WR-02's runtime effect is not proven** — only the trigger's existence and wiring.
5. Only **WR-04** is proven closed by live behaviour in this run.
