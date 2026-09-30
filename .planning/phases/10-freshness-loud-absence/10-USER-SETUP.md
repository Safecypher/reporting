# Phase 10: User Setup Required

**Generated:** 2026-09-30
**Phase:** 10-freshness-loud-absence
**Status:** Incomplete

Complete this item for FRESH-04 (the daily freshness alert) to actually reach Slack.
Claude automated everything possible — the drain route, the evidence trail, the composer,
and the bounded POST are all built and unit-tested. This is the one remaining item: a
real Slack incoming-webhook URL, which only a human with access to the target Slack
workspace can create.

## Environment Variables

| Status | Variable | Source | Add to |
|--------|----------|--------|--------|
| [ ] | `SLACK_WEBHOOK_URL` | Slack → the target workspace → Apps → Incoming Webhooks → Add New Webhook to Workspace → pick the channel → copy the `https://hooks.slack.com/services/...` URL | Netlify (Site configuration → Environment variables) **and** local `.env.local` |

**Server-only — it must never be prefixed `NEXT_PUBLIC_`.** `lib/notify/slack.ts` and
`app/api/ingest/drain/route.ts` read it only via `process.env` inside a Node route
handler; it is never passed to a client component, never returned from a Server Action,
and never written into `alert_runs` or a `console` call (grep-enforced, T-10-09).

## Account Setup

- [ ] **Confirm the target Slack workspace and channel** with the team (Mark/Richard/Andy)
  before minting the webhook — the webhook posts as this app into whichever channel is
  chosen at creation time, and channel is not reconfigurable afterward without minting a
  new webhook.

## Dashboard Configuration

- [ ] **Create the incoming webhook**
  - Location: Slack → the target workspace → Apps → search "Incoming Webhooks" → Add to
    Slack (or, if a custom Slack app already exists for this integration, Slack API →
    Your Apps → the app → Incoming Webhooks → Add New Webhook to Workspace)
  - Pick the channel this app should post freshness alerts into
  - Copy the generated URL immediately (`https://hooks.slack.com/services/T.../B.../...`)

- [ ] **Set `SLACK_WEBHOOK_URL` in Netlify**
  - Location: Netlify → Site configuration → Environment variables → Add a variable
  - Scope: Production (and any preview/branch deploys that should also alert)

- [ ] **Set `SLACK_WEBHOOK_URL` in local `.env.local`** (for anyone running the drain
  route locally against a real webhook during development)

## Verification

After completing setup, verify with:

```bash
# Confirm the env var is present in the deployed environment (value not echoed):
netlify env:get SLACK_WEBHOOK_URL --context production
```

Expected results:
- The command reports the variable is set (its value is never printed to a terminal by
  this project's convention — only its presence is confirmed).
- The actual end-to-end proof — a real POST reaching the real Slack channel — is
  deliberately **not** part of this plan's verification. Per `10-03-PLAN.md`'s own
  `<verification>` section: *"The live end-to-end alert (a real POST reaching a real
  channel) is NOT proven here — that is plan 10-06's job, after the migrations are
  applied and `SLACK_WEBHOOK_URL` is set in Netlify."* This file exists so that
  precondition is visible and checklisted well before plan 10-06 needs it.

---

**Once all items complete:** Mark status as "Complete" at top of file.
