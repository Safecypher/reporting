---
phase: "08"
slug: "period-and-pricing-correctness"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-09-23"
---

# Phase 08 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

Register source: `08-05-PLAN.md`'s `<threat_model>` block — authored at plan time, so this
audit verifies the declared mitigations rather than building a register retroactively. Plans
08-01 through 08-04 declared no threat model; their changes are period-arithmetic and
type-generation work behind the same boundaries listed below, with the one exception of
migration 0039 (08-03), whose advisory lock is cited as a mitigating control for T-08-01.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| operator → client form | The operator supplies `effective_from`. The confirmation gate is a **disclosure** control on this side, never an authorization control. | Tier-set effective dates and rates, already visible to the same authenticated operator |
| client → Server Action (`savePricingTierSet`) | The real boundary. Zod re-validation plus the `save_pricing_tier_set` RPC's data-window coverage guard and advisory lock (migration 0039). | Full tier-set payload — rates, effective date, tier bands |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-08-01 | Tampering | `resolveRestateGate` in `pricing-tier-form.tsx` — client-side, bypassable by a crafted request | medium | accept | Bypassing the gate skips only disclosure. The server re-validates independently: `pricingTierSetSchema.safeParse` (`app/(dashboard)/settings/pricing/actions.ts:49`), `supabase.auth.getUser()` (`:57`), and the `save_pricing_tier_set` RPC (`:69`) which takes `pg_advisory_xact_lock(20260813)` before evaluating data-window coverage (`supabase/migrations/0039_pricing_tier_coverage_guard_lock.sql:119`). | closed |
| T-08-02 | Repudiation | Tier-set pricing-authority transfer | high | mitigate | `resolvePricingAuthorityMove` returns non-null when **either** `supersedes` or `futureSupersededBy` is set (`lib/pricing/restate-gate.ts:68`); `resolveRestateGate` then returns a `confirm` decision without ever reading `restatedDays` (`:90–106`), so the always-confirm guarantee cannot be conditioned on activity days. Both affected sets are named in the dialog via `buildRestateDialogCopy`. Wired at all three consumers in `pricing-tier-form.tsx` (`:239` preview, `:357` submit gate, `:399` dialog copy). | closed |
| T-08-03 | Information disclosure | Dialog copy interpolating tier-set effective dates | low | accept | Effective dates are already visible to the same authenticated internal operator in the tier-set selector on the same page. No new data crosses any boundary. | closed |
| T-08-SC | Tampering | npm/pip/cargo installs | n/a | n/a | Not applicable — no package-manager install task in this phase; no new dependency added and `package.json` is not in any plan's `files_modified`. | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-08-01 | T-08-01 | The client gate is a disclosure control, not an authorization control. Accepting a bypassable disclosure control is correct where the authorization decision is re-made server-side under the same schema and an advisory lock — which it is, and that was verified by inspection rather than assumed. | Mark Wright | 2026-09-23 |
| AR-08-02 | T-08-03 | Dialog copy reveals no date the same authenticated operator cannot already read on the same page. | Mark Wright | 2026-09-23 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-23 | 4 | 4 | 0 | Claude (secure-phase, L1 short-circuit) |

Verification depth: ASVS L1. Per the secure-phase short-circuit rule, a register authored at
plan time with zero open threats at L1 is closed on grep-depth evidence without spawning the
auditor. Every mitigation cited above was located in the code on disk during this audit, not
read from the plan's claims.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-23
