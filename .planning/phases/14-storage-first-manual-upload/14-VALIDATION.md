---
phase: "14"
slug: "storage-first-manual-upload"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-20"
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `14-RESEARCH.md` § Validation Architecture. Working requirement IDs P14-01..P14-14 are
> defined there (no IDs are mapped in REQUIREMENTS.md).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.11 |
| **Config file** | `vitest.config.mts` |
| **Quick run command** | `npm test -- lib/ingestion lib/upload lib/push lib/__tests__/proxy-matcher.test.ts` |
| **Full suite command** | `npm test` (+ `npx tsc --noEmit`, `npm run lint`) |
| **Estimated runtime** | ~60 seconds |

Baseline measured 2026-10-20: `npm test` 51 files / 926 tests pass; `tsc --noEmit` clean; lint 0 errors, 21 warnings.

---

## Sampling Rate

- **After every task commit:** `npm test -- <the touched test file>` then `npx tsc --noEmit`
- **After every plan wave:** `npm test` + `npx tsc --noEmit` + `npm run lint` (0 errors; warnings must not grow past 21)
- **Before `/gsd-verify-work`:** Full suite green, Phase 13 fences clean, deployed checkpoints (P14-12..P14-14) recorded. Unit green alone never closes P14-14.
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

Task IDs are filled in by the planner/executor; requirement-level map below.

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| P14-01 | Key codec round-trip + mint route 401/400/413, `upsert` off | unit | `npm test -- lib/ingestion/__tests__/inbox-object.test.ts` | ❌ W0 | ⬜ pending |
| P14-02 | Foreign/malformed key refused (404), own key accepted | unit | `npm test -- lib/ingestion/__tests__/claim-upload.test.ts` | ❌ W0 | ⬜ pending |
| P14-03 | Oversize refused before download / by real byte length; XLSX cap → failed row | unit | `npm test -- lib/ingestion/__tests__/claim-upload.test.ts` | ❌ W0 | ⬜ pending |
| P14-04 | Verdict kinds → today's HTTP shapes | unit | `npm test -- lib/ingestion/__tests__/claim-upload.test.ts` | ❌ W0 | ⬜ pending |
| P14-05 | Terminal outcomes remove object; throw leaves it → `received`; double-claim calm | unit | `npm test -- lib/ingestion/__tests__/claim-upload.test.ts` | ❌ W0 | ⬜ pending |
| P14-06 | Shared per-object function: push byte-equivalent, manual attributed | unit | `npm test -- lib/ingestion/__tests__/inbox-object.test.ts lib/push/__tests__/spine.test.ts` | ❌ W0 / extend | ⬜ pending |
| P14-07 | Drain ingests old `manual/` object, skips young + dot-files | unit | `npm test -- lib/push/__tests__/spine.test.ts` | extend | ⬜ pending |
| P14-08 | /uploads "received, not yet processed" list | unit | `npm test -- lib/upload/__tests__/inbox-received.test.ts` | ❌ W0 | ⬜ pending |
| P14-09 | `received` outcome, stage strings, sequential loop | unit | `npm test -- lib/upload/__tests__/batch.test.ts` | extend | ⬜ pending |
| P14-10 | Header read ≤ 64 KiB slice, classification unchanged | unit | `npm test -- lib/ingestion/__tests__/ingestion.test.ts` | extend | ⬜ pending |
| P14-11 / 11b | Windowed CSV == whole-file; one window held at a time | unit | `npm test -- lib/ingestion/__tests__/csv-windows.test.ts lib/ingestion/__tests__/billing.test.ts` | ❌ W0 | ⬜ pending |
| P14-gate | Phase 13 handler fence, install-nothing fence | shell | re-run 13-08 Task 1 fence commands, base `e55abda` | reuse | ⬜ pending |
| P14-pm | New routes stay session-gated | unit | `npm test -- lib/__tests__/proxy-matcher.test.ts` | extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `lib/ingestion/__tests__/inbox-object.test.ts`
- [ ] `lib/ingestion/__tests__/claim-upload.test.ts`
- [ ] `lib/ingestion/__tests__/csv-windows.test.ts`
- [ ] `lib/upload/__tests__/inbox-received.test.ts`
- [ ] extend `ingestion.test.ts`, `spine.test.ts`, `batch.test.ts`, `proxy-matcher.test.ts`
- [ ] `scripts/gen-synthetic-billing.mjs`, `scripts/bench-ingest-memory.mts` (pre-window dates by default)

Framework install: none.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `ingested_files` grants: anon none, authenticated SELECT only | P14-12 | Live catalog; executors lack Supabase MCP | Orchestrator runs catalog queries from RESEARCH Code Examples before and after migration 0051 |
| Inbox bucket limit 52,428,800 (50 MiB, D-20; supersedes the 100 MiB / Pro row), MIME null; exact cap accepted, cap + 1 refused | P14-13 | Live catalog; executors lack Supabase MCP (no Pro upgrade under D-20) | Orchestrator applies 0052 and runs its oracle via MCP (14-03 Task 4); boundary probe through signed upload URLs on the deployed project (14-06 Task 3 step A) |
| Real 22.4 MB billing → `done`; ~49 MiB pre-window synthetic → `done` with transfer + claim latency (D-20; replaces the 99 MiB proof) | P14-14 | Deployed site only | Deployed checkpoints; record rows/s, the 52,428,800-byte projection and latency in SUMMARY; clean up synthetic rows/objects |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
