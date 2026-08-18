# Phase 1: End-to-End Spine - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-18
**Phase:** 1-end-to-end-spine
**Areas discussed:** Account provisioning, Chart timezone, Dedup key strictness, Demo data readiness

---

## Account Provisioning

| Option | Description | Selected |
|--------|-------------|----------|
| Manually seeded | Create the ~4 accounts directly in Supabase; no signup UI | ✓ |
| Invite-only | Existing user invites; invitee sets password | |
| Domain-restricted signup | @safecypher.com self-registration with email verification | |

**User's choice:** Manually seeded
**Notes:** No public signup and no signup UI in Phase 1. AUTH scope is login + session + route gating only.

---

## Chart Timezone (verifications-over-time bucketing)

| Option | Description | Selected |
|--------|-------------|----------|
| UK time (Europe/London) | Bucket by London day | |
| UTC | Bucket by UTC day | (partial) |
| Deployment local (US Central) | Bucket by Invex event-origin day | |
| **Other (user)** | **UTC by default with a selector to choose display timezone** | ✓ |

**User's choice:** UTC by default + display-timezone selector.
**Follow-ups:**
- Selector behaviour → **Session-only toggle** (resets to UTC each visit; nothing persisted). (Alternatives offered: per-user remembered; global default.)
- Selector options → **UTC + UK + US Central** (America/Chicago). (Alternatives offered: UTC+UK only; full IANA list.)

---

## De-duplication Key Strictness (verification report)

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — retries are real | Same card can verify multiple times in quick succession; each kept | ✓ |
| No — should be unique | Same-instant duplicates are artifacts; collapse them | |
| Not sure | Flag for researcher/Joachim | |

**User's choice:** Retries are real.
**Follow-up — dedup key:**

| Option | Description | Selected |
|--------|-------------|----------|
| Whole row (all columns) | Hash all columns; only byte-identical re-ingests collapse; real retries always kept | ✓ |
| Timestamp + card only | Looser; risks collapsing same-millisecond retries | |
| Flag for confirmation | Whole-row now, confirm backend later | |

**Notes:** Whole-row hash (CreatedAt + ExternalCardReference + Cvi2Value + duration + Authenticated) with UNIQUE + ON CONFLICT DO NOTHING. A duration-only difference must preserve both rows.

---

## Demo Data Readiness

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-load historical CSVs | Seed 13-Aug-onward verification reports so the chart is populated on first login | ✓ |
| Start empty | Upload live during the demo | |
| Both / seed script | Ship empty with a seed script to decide at demo time | |

**User's choice:** Pre-load historical CSVs (via a repeatable seed running the same idempotent ingestion path).
**Notes:** Depends on Richard sending historical files from 13 Aug; until then the seed uses the 13-Aug sample only. Chase the files before the demo.

---

## Claude's Discretion

- Exact schema/column types, `row_hash` mechanism, App Router structure, Supabase server-client wiring, `ingested_files` shape — deferred to research/planner (see ARCHITECTURE.md).
- Whether the timezone toggle re-queries the server or re-buckets client-side — planner's call (tiny data volumes).

## Deferred Ideas

- Persisted / per-user timezone preference — rejected for v1 (session-only instead).
- Invite-only / domain-restricted signup — deferred in favour of manual seeding.
- Automated ingestion (file drop / webhook) — v2 (AUTO-01); seam built now to accept it.
- Full IANA timezone picker — overkill for v1.
