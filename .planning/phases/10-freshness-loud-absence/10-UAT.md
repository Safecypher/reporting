---
status: testing
phase: 10-freshness-loud-absence
source: [10-VERIFICATION.md]
started: 2026-09-30T16:30:00Z
updated: 2026-09-30T16:30:00Z
---

## Current Test

number: 1
name: Set SLACK_WEBHOOK_URL and prove FRESH-04 end to end with a real message
expected: |
  One Slack message reaches the chosen channel, grouped by wrong-state per D-11's shape, and
  exactly one new alert_runs row is written with posted=true and a 2xx http_status. No column
  of that row contains any substring of the webhook URL.
awaiting: user response

## Tests

### 1. Set SLACK_WEBHOOK_URL and prove FRESH-04 end to end with a real message
expected: One Slack message in the target channel; exactly one new `alert_runs` row with `posted=true` and a 2xx `http_status`; no column of that row contains any part of the webhook URL.
result: [pending]

Steps:
1. Slack → target workspace → Apps → Incoming Webhooks → Add New Webhook to Workspace → choose the channel → copy the `https://hooks.slack.com/services/...` URL.
2. Netlify → Site configuration → Environment variables → add `SLACK_WEBHOOK_URL`. Add the same to local `.env.local`. It must NOT be prefixed `NEXT_PUBLIC_`, and it does NOT go in Vault — unlike `DRAIN_CRON_SECRET` it is read from `process.env` inside the Node route.
3. Trigger a redeploy so the running build has the variable.
4. Invoke the drain once with the cron secret.

**Expect a real message, not silence.** All six sources currently read `stale = true` (no
coverage past 2026-09-27, nothing uploaded since 2026-09-28), so this run has something to say.
Silence here would itself be a finding.

I will then read `alert_runs` and confirm the row, the status, and the absence of the webhook
URL from every column.

### 2. Prove D-14 through the app's own request path
expected: `cron.job.schedule` for `daily-drop-off` matches the new value after the first save and reads `0 16 * * *` again after the second; `app_settings.drain_cron_run_time` agrees; exactly two `app_settings_audit` rows are written naming the run-time change.
result: [pending]

Steps: on the deployed `/settings/sources`, change the daily check run time, confirm the success
toast, then set it back to 16:00 and confirm again.

Plan 10-02 already proved `cron.alter_job` is reachable in isolation (transaction-wrapped, rolled
back). What is unproven is the full path: the Server Action, the compensating-write rollback, and
the `authenticated` RPC grant exercised through a live session. Tell me when both saves are done
and I will read `cron.job` and `app_settings_audit` directly.

### 3. The seven-point walkthrough (10-06-PLAN.md Task 3)
expected: All seven points hold exactly as the UI-SPEC describes.
result: [pending]

Against the DEPLOYED app, signed in:

1. **Dashboard home** — the six-source strip sits below the page header and ABOVE the alignment strip; the old "Data as of last import: …" badge is gone. All six sources present, in order: Verification, Billing, DCVV, Card inventory, Removed cards, APIGEE stats. Each shows a **word**, not just a colour. Every source should currently read **Overdue** — that matches the live `v_source_freshness` rows.
2. **No caption under "No report received"** — no date, no dash, no "Uploaded: —". (With current data you may not see this state; if every source is Overdue, note it as not-exercised rather than passed.)
3. **`/uploads`** — the identical strip renders between the dropzone and the upload history, and both still work: drag a file in, confirm it ingests and appears in the history attributed to your account.
4. **Inbox-stuck sentence** — if `alert_runs` recorded a non-zero `inbox_stuck_count`, the warning-coloured line appears above the six sources naming the count and a time. If zero, confirm the line is **absent** — not "0 objects stuck", not an empty row.
5. **`/settings/sources`** — six rows in the same order as the strip; change one threshold and confirm a Save button appears on **that row only**; save it; confirm the success toast, that the change history gains an entry naming you, and that the dashboard strip reflects the new threshold **without a redeploy**.
6. **375px** — on both the dashboard and `/settings/sources`, the strip wraps rather than overflowing and the settings table scrolls horizontally with all five columns intact.
7. **Colour-independence** — read the strip as someone who cannot distinguish the tints. Is every state unambiguous from the words alone?

Point 7 is the one worth slowing down on. Phase 9's defect G-09-1 survived 587 passing tests, a
clean `tsc`, a clean lint, a full code review, five pinned blob hashes and a passing phase
verification — and was caught by the first human question of the session.

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
