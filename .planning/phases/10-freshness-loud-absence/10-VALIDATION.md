---
phase: "10"
slug: "freshness-loud-absence"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: false
wave_0_complete: true
created: "2026-09-30"
reconstructed_from_artifacts: true
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
>
> **Reconstructed retroactively** by `/gsd-validate-phase 10` on 2026-09-30 (State B —
> six SUMMARY files present, no VALIDATION.md had been authored). Phase 10 was planned
> and executed while `workflow.nyquist_validation` was `false`, so no validation
> contract was seeded at plan time. The toggle was enabled during this audit and this
> document is the result.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3 (ESM + TypeScript, `@/` alias to repo root) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run <path>` |
| **Full suite command** | `npm test` (= `vitest run`) |
| **Estimated runtime** | ~1 second (674 tests; 42 files) |
| **Secondary harness** | `supabase/tests/*.sql` — hand-rolled `do $$ … raise exception … $$;` oracles. **No pgTAP in this repo.** Requires a live database; NOT part of `npm test`. |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <touched path>`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~1 second (full suite) — fast enough that the quick/full
  distinction carries almost no cost in this repo; prefer the full suite.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | FRESH-01 | T-10-01 | Views run `security_invoker = on`, so freshness reads honour the underlying tables' RLS | unit | `npx vitest run lib/dashboard/__tests__/freshness.test.ts` | ✅ | ✅ green |
| 10-01-02 | 01 | 1 | FRESH-01 | — | N/A — mount only | unit | `npx vitest run lib/dashboard/__tests__/freshness.test.ts` | ✅ | ✅ green |
| 10-01-03 | 01 | 1 | FRESH-02 | T-10-01 | Staleness verdict is a pure function of (covered day, cadence, threshold, as_of); reads no table, mutates nothing | SQL oracle | `psql -f supabase/tests/source_freshness_weekend_rule_test.sql` | ✅ | ⚠️ green (live DB only — see Manual-Only) |
| 10-02-01 | 02 | 1 | FRESH-05 | T-10-06, T-10-08 | Probe is transaction-wrapped and rolled back; verdict requires a read-back, not `has_function_privilege` alone | manual probe | — (one-off live measurement, recorded as a git-tracked constant) | ✅ | ⬜ n/a — see Manual-Only |
| 10-02-02 | 02 | 1 | FRESH-05 | T-10-07 | Verdict is a git-tracked constant carrying the actual catalog rows | — | `npx tsc --noEmit` | ✅ | ✅ green |
| 10-03-01 | 03 | 2 | FRESH-04 | T-10-09, T-10-10, T-10-12 | Webhook URL never returned/persisted/logged; POST bounded by `AbortSignal.timeout(8000)`; response body sliced, never parsed | unit | `npx vitest run lib/notify/__tests__/slack.test.ts` | ✅ | ✅ green |
| 10-03-02 | 03 | 2 | FRESH-03, FRESH-04 | T-10-11, T-10-13 | Exactly one `alert_runs` row per non-409 run, written BEFORE the POST; alerting failure never cascades into ingestion | unit | `npx vitest run lib/notify/__tests__/drain-alert.test.ts` | ✅ | ✅ green |
| 10-03-03 | 03 | 2 | FRESH-04 | T-10-10 | `export const maxDuration = 60` matches pg_net's 60000ms wait | unit | `npx vitest run lib/notify/__tests__/drain-alert.test.ts` | ✅ | ✅ green |
| 10-04-01 | 04 | 2 | FRESH-05 | T-10-14, T-10-17 | Server-side re-validation with the same Zod schema before any DB access; `reportType` a closed enum of the six seeded values | unit | `npx vitest run lib/settings/__tests__/schema.test.ts` | ✅ **(added by this audit)** | ✅ green |
| 10-04-02 | 04 | 2 | FRESH-05 | T-10-15, T-10-18 | Session-scoped `@/lib/supabase/server` client only, so `auth.uid()` reaches the audit trigger; raw DB errors never reach the client | unit | `npx vitest run lib/settings/__tests__/source-settings-actions.test.ts` | ✅ **(added by this audit)** | ✅ green |
| 10-04-03 | 04 | 2 | FRESH-05 | T-10-16 | `components/ui/switch.tsx` imports `cn` from `@/lib/utils`; no `cn` package dependency | lint/type | `npx tsc --noEmit && npx eslint` | ✅ | ✅ green |
| 10-05-01 | 05 | 3 | FRESH-05 | T-10-19, T-10-20, T-10-21, T-10-22 | SECURITY DEFINER, narrowed EXECUTE grant, `time` parameter (not text), addressed by jobname, schedule read back after alter | SQL + catalog | — (live catalog reading, 10-06 D5/D8) | ✅ | ⬜ n/a — see Manual-Only |
| 10-05-02 | 05 | 3 | FRESH-05 | T-10-23 | Stored setting and live schedule never diverge silently — RPC failure triggers a compensating restore, never a success result | unit | `npx vitest run lib/settings/__tests__/source-settings-actions.test.ts` | ✅ **(added by this audit)** | ✅ green |
| 10-05-03 | 05 | 3 | FRESH-05 | — | Editable-vs-read-only is a per-deploy constant, never a per-request branch | unit | `npx vitest run lib/settings/__tests__/schema.test.ts` | ✅ **(added by this audit)** | ✅ green |
| 10-06-01 | 06 | 4 | FRESH-01…05 | T-10-25 | Every grant/revoke/RLS policy confirmed against the live catalog, never against the applied SQL | manual | — | ✅ | ⬜ n/a — see Manual-Only |
| 10-06-02 | 06 | 4 | FRESH-01…05 | T-10-24 | Types generated to a temp file and inspected before `mv` — never a stdout redirect over the tracked file | type | `npx tsc --noEmit` | ✅ | ✅ green |
| 10-06-03 | 06 | 4 | FRESH-04 | T-10-26, T-10-27 | Real webhook lives only in Netlify env + `.env.local`; live reschedule deliberately not performed | manual | — | ✅ | ⬜ n/a — see Manual-Only |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. Vitest was already installed and
configured; no framework install was needed.

Two files were added retroactively by this audit to close the FRESH-05 gap:

- [x] `lib/settings/__tests__/schema.test.ts` — **extended** with `reportSourceSettingsSchema`
      and `drainRunTimeSchema` describe blocks (the three pre-Phase-10 schema blocks were
      left untouched)
- [x] `lib/settings/__tests__/source-settings-actions.test.ts` — **new**; exercises the real
      `saveReportSourceSettings` / `saveDrainRunTime` Server Actions against a stubbed
      Supabase client, mirroring the `alignment-settings.test.ts` precedent

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Weekend-grace rule over `fn_source_is_stale` | FRESH-02 | The oracle **is** automated, but it is SQL against a live database and this repo has no pgTAP and no CI database — so `npm test` cannot run it. A FRESH-02 regression would not be caught by the normal runner. | Run `supabase/tests/source_freshness_weekend_rule_test.sql` against the project. A failure raises an exception; silence is a pass. |
| One real Slack message reaches a real channel | FRESH-04 | Requires a human-created incoming webhook and a real deploy. The code path is fully unit-tested against an injected fake `fetch`, but no real POST has ever been sent. | Per `10-USER-SETUP.md`: set `SLACK_WEBHOOK_URL` in Netlify, redeploy, invoke the drain with the cron secret. Expect exactly one message and exactly one new `alert_runs` row with `posted=true`, and no column containing any substring of the webhook URL. |
| Run-time save moves the live cron schedule through the app's request path | FRESH-05 | Plan 10-02 proved `cron.alter_job` reachable in isolation (transaction-wrapped, rolled back) and 10-06 deliberately declined to mutate a production schedule. The Server Action, the compensating-write rollback and the authenticated RPC grant have never been exercised together against a live session. T-10-27 is the recorded residual. | On the deployed `/settings/sources`, change the run time, confirm the toast, then read `cron.job` and `app_settings_audit` directly. Expect the schedule moved, `app_settings.drain_cron_run_time` to match, and two audit rows. |
| Seven-point visual walkthrough of the freshness strip | FRESH-01, FRESH-03 | Grep and file checks cannot see rendered layout, colour-independent legibility, or narrow-viewport wrapping. Phase 9's defect G-09-1 survived 587 tests, clean `tsc`/lint, a full code review and a passing verification — and was caught by the first human UAT question. | The walkthrough in `10-06-PLAN.md` Task 3's `<human-check>`: strip placement and order on both pages, no caption under "No report received", the inbox-stuck sentence's presence/absence, a threshold save reflected without redeploy, 375px behaviour, and colour-independent legibility of all five states. |

---

## Validation Audit 2026-09-30

| Metric | Count |
|--------|-------|
| Gaps found | 3 |
| Resolved | 3 |
| Escalated | 0 |

**Gap detail.** All three sat under FRESH-05 and all three were MISSING, not PARTIAL:

1. `reportSourceSettingsSchema` — zero tests
2. `drainRunTimeSchema` — zero tests
3. `saveReportSourceSettings` / `saveDrainRunTime` — zero tests

This mattered more than the raw count suggests. Plan 10-04's own must-have states that
*"Every save is re-validated server-side with the SAME Zod schema the client form uses;
the client validation is UX only and this Server Action is an untrusted entry point"* —
and that untrusted entry point carried no regression test. T-10-14, T-10-15, T-10-17 and
T-10-23 were all closed in `10-SECURITY.md` on the strength of source reading alone.

**Measured outcome (re-measured by the orchestrator, not taken from the auditor's report):**

| | Before | After |
|---|---|---|
| Test files | 41 | 42 |
| Tests | 640 | 674 |
| Result | all passing | all passing |

`npx tsc --noEmit` and `npx eslint` both clean on the two changed files. `git status`
confirms no implementation file was modified — the audit added tests only.

**Behavioural, not structural.** Two assertions worth naming, because they pin decisions
rather than shapes: a forged seventh `reportType` (`"forged-source"`) is rejected with the
update mock provably never called, and an `fn_set_drain_cron_schedule` RPC failure produces
two `update` calls — the new value, then a compensating restore to the previously-read
`"16:00"` — plus a non-success result. That second one is T-10-23's "never silently report
success" made executable.

---

## Validation Sign-Off

- [x] All tasks have an automated verify or an explicit Manual-Only entry
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s (measured ~1s)
- [ ] `nyquist_compliant: true` — **NOT set.** Four behaviours remain manual-only, one of
      them (the FRESH-02 weekend oracle) automated but unrunnable by `npm test`. Phase 10
      is **VALIDATED (PARTIAL)**.

**Approval:** pending — the four Manual-Only rows carry over to `/gsd-verify-work` and
`10-VERIFICATION.md`'s `human_verification` block, which already names three of them.
