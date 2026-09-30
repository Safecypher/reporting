---
phase: "10"
slug: "freshness-loud-absence"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-09-30"
---

# Phase 10 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

Register origin: **authored at plan time** — all six PLAN files carry a
`<threat_model>` block. This audit verifies the declared mitigations exist; it
does not retroactively construct a register.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| browser → PostgREST (`authenticated` role) | Any signed-in internal user can read every view/table this phase creates and can UPDATE `report_sources`. RLS and grants are the only control. | Freshness thresholds, audit rows, alert-run evidence |
| PostgREST → SECURITY DEFINER function | The public schema exposes any function as a callable RPC unless EXECUTE is revoked. | Audit-trigger execution; cron reschedule |
| view → underlying table RLS | A view without `security_invoker` executes as its owner and bypasses the policies beneath it. | `dcvv_fetches`, `ingested_files`, `report_sources` rows |
| browser → Server Action | `saveReportSourceSettings` / `saveDrainRunTime` are directly-invocable untrusted entry points. | Cadence, staleness thresholds, production job run time |
| Next.js Node route → Slack (outbound, third party) | Composes a message to an external service and reads back an untrusted response body. | Freshness summary text; Slack response body |
| `process.env` → persisted row / log line | `SLACK_WEBHOOK_URL` is bearer-equivalent: anyone holding it can post as this app. | Webhook secret |
| pg_cron / pg_net → drain route | The only authenticated caller, via the pre-existing `DRAIN_CRON_SECRET` bearer check. | Drain trigger |
| secret-key server client → `alert_runs` | Writes bypass RLS entirely. The only writer. | Alert evidence rows |
| `app_settings` row → `cron.job` | Two stores that must agree; divergence is silent by default. | Daily check run time |
| orchestrator session → live production database | DDL and probes against a database holding live revenue data. | Schema, cron schedule |
| Supabase CLI stdout → tracked source file | A redirect makes a failed command's error output the new contents of `types/db.ts`. | Generated types |
| shadcn CLI → `package.json` / `components/ui/` | A copy-in command that also installs a package introduces an unreviewed dependency. | Build-time dependency graph |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-10-01 | Information Disclosure | `v_dcvv_coverage_daily`, `v_source_freshness` | medium | mitigate | Both views `with (security_invoker = on)` — `0046` grep count 4 (2 declarations + 2 comments); live `pg_class.reloptions` = `["security_invoker=on"]` for both (10-06 D2) | closed |
| T-10-02 | Elevation of Privilege | `fn_report_sources_audit()` | high | mitigate | `0046:194` `revoke execute on function fn_report_sources_audit() from public, anon, authenticated;`; live `pg_proc` anon_exec=false auth_exec=false (10-06 D5) | closed |
| T-10-03 | Repudiation | `report_sources_audit` | medium | mitigate | Append-only — `0046` declares only a SELECT policy; live `pg_policies` returned exactly 4 policies (3 SELECT + 1 UPDATE on `report_sources`), no INSERT/DELETE anywhere (10-06 D6) | closed |
| T-10-04 | Tampering | `report_sources` grants | high | mitigate | `0046:351` table-wide `revoke all … from anon, authenticated;` before `0046:355` `grant select, update … to authenticated;`; live `information_schema.table_privileges` = 4 rows, all `authenticated`, zero rows for `anon` (10-06 D4) | closed |
| T-10-05 | Tampering | `alert_runs` | medium | mitigate | `0046:353` revoke-all then `0046:357` `grant select` only; RLS on, SELECT policy only; written solely by the secret-key server client (10-06 D4/D6) | closed |
| T-10-06 | Tampering | step-4 dry run against `cron.job` | high | mitigate | Deviation, strictly safer: submitted as one `do $$ … raise exception 'PROBE_READBACK …' $$;` body so the abort is guaranteed rather than trusted by the harness. Live `cron.job` still `0 16 * * *` (10-06 D8) | closed |
| T-10-07 | Repudiation | the recorded verdict | medium | mitigate | `DRAIN_SCHEDULE_EDITABLE` is a git-tracked constant whose doc comment carries the actual catalog rows and probe date | closed |
| T-10-08 | Elevation of Privilege | editable control on a false-positive verdict | medium | mitigate | REACHABLE required a step-4 read-back of the probed value, not `has_function_privilege` alone — the silent-no-op shape checked explicitly | closed |
| T-10-09 | Information Disclosure | `SLACK_WEBHOOK_URL` | high | mitigate | Read only at `app/api/ingest/drain/route.ts:246` inside the Node route; never returned, never persisted, never logged (explicit `// Never include webhookUrl in this log line (T-10-09).` at the catch); zero `NEXT_PUBLIC_SLACK*` occurrences repo-wide | closed |
| T-10-10 | Denial of Service | outbound Slack POST | medium | mitigate | `lib/notify/slack.ts:167` `signal: AbortSignal.timeout(SLACK_POST_TIMEOUT_MS)` (8000ms); `route.ts:27` `export const maxDuration = 60` | closed |
| T-10-11 | Repudiation | a silently broken notifier | high | mitigate | One `alert_runs` row per non-409 run, inserted BEFORE the post and updated with `posted` / `http_status` / bounded `response_body` / `error`; missing env var recorded as `posted:false` with a naming error rather than silence | closed |
| T-10-12 | Tampering | untrusted Slack response body | low | mitigate | `lib/notify/slack.ts:172-173` `res.text()` then `.slice(0, MAX_RECORDED_BODY_LENGTH)` (500). Never JSON-parsed, never evaluated, never rendered as HTML | closed |
| T-10-13 | Denial of Service | alerting failure cascading into ingestion | medium | mitigate | Every alerting step wrapped in try/catch downstream of `drainInbox`; all three exits return `{ processed: result.processed }` at `result.status` unchanged. WR-01 closed the remaining rejection path on the `alert_runs` insert | closed |
| T-10-14 | Tampering | `saveReportSourceSettings` input | high | mitigate | `actions.ts:51` `reportSourceSettingsSchema.safeParse` before any DB access; `reportType` a closed `z.enum` of the six seeded values (`lib/settings/schema.ts:113`); backed by `report_sources` CHECK constraints | closed |
| T-10-15 | Repudiation | audit attribution | high | mitigate | `actions.ts:5` imports the session-scoped `createClient` from `@/lib/supabase/server` — no secret-key client in the file — so `auth.uid()` reaches `trg_report_sources_audit`; the action never writes `report_sources_audit` | closed |
| T-10-16 | Tampering | supply chain via `npx shadcn add switch` | high | mitigate | **Fired for real:** the CLI emitted `import { cn } from "cn"` and added `cn@0.4.0`. Caught by the plan's own `git diff --exit-code` gate, reverted in commit `0237ceb`. Now `components/ui/switch.tsx:4` imports from `@/lib/utils`, `grep -c '"cn"' package.json` == 0 | closed |
| T-10-17 | Elevation of Privilege | row scope of the UPDATE | medium | mitigate | `actions.ts:73` `.eq("report_type", parsed.data.reportType)` on a validated enum; no `upsert` and no `insert` in the file | closed |
| T-10-18 | Information Disclosure | DB error text returned to client | low | mitigate | Raw error `console.error`d server-side only; client receives `friendlyReportSourceSettingsErrorMessage(...)` / `DRAIN_RUN_TIME_GENERIC_ERROR` | closed |
| T-10-19 | Elevation of Privilege | `fn_set_drain_cron_schedule` | high | mitigate | `0047:184-185` `security definer` + `set search_path = public, cron`; `0047:238-240` revoke from `public`, revoke from `anon`, grant to `authenticated`; live `pg_proc` anon_exec=false auth_exec=true, owner=postgres, prosecdef=true (10-06 D5). Callable by `authenticated` is deliberate under L-04 — no RBAC exists; D-13's answer is audit, not restriction | closed |
| T-10-20 | Tampering | cron-expression injection | high | mitigate | `0047:181` takes `p_run_time time`, not text; `0047:196-197` composes the expression from `extract(minute …)` / `extract(hour …)`. No caller-controlled path to another job or extra fields | closed |
| T-10-21 | Denial of Service | mis-targeting or losing the job | high | mitigate | `0047:205` lookup `where jobname = 'daily-drop-off'`, `0047:208` raises when absent; `0047:213` `cron.alter_job` in place — zero `cron.schedule` / `cron.unschedule` calls. Live `cron.job` = exactly 2 rows (10-06 D8), honouring `0043`'s EXACTLY ONE JOB rule | closed |
| T-10-22 | Repudiation | a silent no-op reschedule | high | mitigate | `0047:215-227` reads `cron.job.schedule` back and `raise exception 'cron.alter_job did not take effect: schedule is still %'` when unchanged — the `0042` silent-grant precedent made structural | closed |
| T-10-23 | Tampering | stored setting diverging from live schedule | high | mitigate | `actions.ts` restores `previousRunTime` on RPC error (compensating write producing its own audit row); `actions.ts:140` `if (!DRAIN_SCHEDULE_EDITABLE)` refuses before touching the database | closed |
| T-10-24 | Tampering | `types/db.ts` regeneration | medium | mitigate | Generated to a temp file, inspected, then `mv`d into place — never a stdout redirect over the tracked file. The failure mode fired for real on this plan and was caught (10-06 D10); `npx tsc --noEmit` clean after | closed |
| T-10-25 | Repudiation | grant / RLS verification | high | mitigate | Nine live catalog readings recorded with ACTUAL returned rows in 10-06 (D1–D9) against `pg_catalog` / `information_schema` / `pg_policies` / `cron.job` — not against the applied SQL | closed |
| T-10-26 | Information Disclosure | `SLACK_WEBHOOK_URL` at deploy | high | mitigate | Netlify env + `.env.local` only; no tracked dotenv file (`.env.local.example` only); `git log -S` across all refs surfaces only placeholders (`…/services/SECRET`, `…/services/T00/B00/SUPERSECRET`) — no real webhook ever committed | closed |
| T-10-27 | Denial of Service | the live `fn_set_drain_cron_schedule` call | high | mitigate | The live reschedule was deliberately NOT performed (10-06 decision, taken with a human): a direct MCP call would have briefly mutated a production schedule to prove less than the plan asks. `cron.job` confirmed intact at `0 16 * * *` (10-06 D8). See residual note below | closed |
| T-10-SC | Tampering | npm/pip/cargo installs | high | mitigate | Package-legitimacy gate held across all six plans. 10-RESEARCH records no new packages; the one attempted unreviewed install (`cn@0.4.0`) was caught and reverted — see T-10-16 | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Residual Notes

Not accepted risks — mitigations that are present and verified in code and in the
live catalog, but whose end-to-end exercise is carried to UAT:

- **T-10-27 / T-10-19 — the editable reschedule path has not been driven end to
  end in production.** `fn_set_drain_cron_schedule` is applied, correctly owned,
  correctly granted, and its body verified; the Server Action, its compensating
  write and the `authenticated` RPC grant have not been exercised together
  against the live job. 10-06 recorded this as a deliberate deferral to human
  UAT (items D2/D4 of 10-05's hand-off). The control is in place; the proof that
  the whole chain works is outstanding. Closing item: `/gsd-verify-work 10`.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|

No accepted risks. Every threat in the register carries a `mitigate` disposition
and a verified control.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-30 | 28 | 28 | 0 | /gsd-secure-phase (orchestrator, ASVS L1 grep-depth + 10-06 live catalog evidence) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-30
