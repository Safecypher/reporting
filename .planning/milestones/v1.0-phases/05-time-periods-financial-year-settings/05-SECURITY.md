---
phase: "05"
slug: "time-periods-financial-year-settings"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (high)
threats_open: 0
asvs_level: 1
created: "2026-09-10"
---

# Phase 05 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

Register origin: `register_authored_at_plan_time: true` — all nine Phase 5 PLAN files
carry a `<threat_model>` block. This audit verifies that the declared mitigations exist
in the implementation; it does not scan for new threats. Depth: ASVS L1 (grep/read of
the named control at each named artefact, plus the phase's own test suite).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Browser URL → Server Component → PostgREST query builder | `?period=` / `?of=` / `?yearMode=` would otherwise reach `.gte()`/`.lt()` arguments on five metric pages | Untrusted period selectors |
| Authenticated session → `app_settings` | New client-writable org-wide setting table with no RBAC (L-04) | Financial-year start (month/day) |
| `app_settings` UPDATE → `app_settings_audit` | The only record of who moved every FY boundary (D-13) | Actor id, old value, new value |
| Browser form → `saveFinancialYearSettings` Server Action | Directly invocable entry point, not only reachable through the form | FY month/day |
| Browser form → pricing Server Actions → `SECURITY DEFINER` RPCs | Tier values and tier-set ids reach a money-defining write path running as table owner | Rates, effective dates, tier-set ids |
| Editable rates → already-computed revenue | An in-place edit silently restates figures already shown to leadership | Money |
| Tier-set edit/delete → `v_revenue_tier_set_by_day` | An uncovered day vanishes from revenue rather than erroring | Money |
| Authenticated session → `revenue_total_for_period` | New PostgREST-callable SQL function over money | Money |
| Postgres error text → Server Action → browser | Raw constraint/table/function names must never cross back out (WR-01) | Database internals |
| Local migration files → live Postgres | Schema, function and data changes applied to the hosted project | Schema + seeded MSA rates |
| Unauthenticated request → `(dashboard)` layout | `proxy.ts` redirect is the first gate, the layout's `getUser()` the second | Session |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-05-01 | Tampering | Period params → Supabase query builder | high | mitigate | `resolvePeriod` (`lib/dashboard/period.ts`) is the sole choke point: three-key whitelist, `MONTH_OF_RE`/`YEAR_OF_RE`, `Date.UTC` round-trip calendar check (`period.ts:128-132`), always returns a resolved period | closed |
| T-05-02 | Spoofing / Repudiation | FY change with no attributable record | high | mitigate | `fn_app_settings_audit()` is `security definer` + `set search_path = public` (`0023:96-97`), writes `auth.uid()` and old→new; `app_settings_audit` has select-only policy for `authenticated` (`0023:80`), no client insert/update/delete | closed |
| T-05-03 | Elevation of Privilege | `fn_app_settings_audit()` as a PostgREST RPC | medium | mitigate | `revoke execute … from public, anon, authenticated` (`0023:133`); trigger invocation unaffected | closed |
| T-05-04 | Tampering | Duplicate/deleted `app_settings` singleton | medium | mitigate | `check (id = 1)` (`0023:30`); no insert and no delete policy granted | closed |
| T-05-05 | Information Disclosure | New tables readable without a session | high | mitigate | `enable row level security` on both (`0023:66-67`); `to authenticated` select policies only; no `anon` grant in 0023 | closed |
| T-05-06 | Denial of correctness | Scope badge stating a period different from the one queried | high | mitigate | Badge rendered by the same Server Component from the same `ResolvedPeriod` object used to build the query (verified on all five pages) | closed |
| T-05-07 | Tampering | Period params on revenue, SLA, reconciliation, cards, verifications | high | mitigate | All five pages call `resolvePeriod(params, fyStart, now)` and pass only `period.start`/`period.end` into `.gte()`/`.lt()`; no page reads a raw search param into a query | closed |
| T-05-08 | Denial of correctness | Tier ladder re-run over aggregate multi-month volume | critical | mitigate | Scoping is an outer predicate on `v_revenue_daily` output only; blob-hash gate on 0012/0017; D-06 invariant proven live in 05-05 | closed |
| T-05-09 | Denial of correctness | Narrowed period softening a confirmed reconciliation mismatch | critical | mitigate | `bounds`/`settled` CTEs compute inside the view over full tables; page renders the given `status` and never recomputes; blob-hash gate on 0018-0022 + UAT test 8 | closed |
| T-05-10 | Information Disclosure | `revenue_total_for_period` bypassing RLS | high | mitigate | `security invoker` + `set search_path = public` (`0024:38-39`); execute revoked from `public`/`anon`, granted to `authenticated` only (`0024:51-53`) | closed |
| T-05-11 | Tampering | `search_path` hijack on the new function | medium | mitigate | `set search_path = public` pinned (`0024:39`) | closed |
| T-05-12 | Repudiation | Cards KPI reporting a figure from outside the stated period | medium | mitigate | P-02 as-of rule; caption always names the snapshot's real date and states the carried-forward basis (`cards/page.tsx:328`); UAT test 8 | closed |
| T-05-13 | Tampering | Direct `saveFinancialYearSettings` call bypassing client validation | high | mitigate | `financialYearSettingsSchema.safeParse` before any client is created (`general/actions.ts:33`); `make_date(2001, …)` CHECK at the database (`0023:33`) | closed |
| T-05-14 | Spoofing | Unauthenticated caller invoking the Server Action | high | mitigate | `supabase.auth.getUser()` guard returns `Unauthorized` before any write (`general/actions.ts:41`); `app_settings` update policy is `to authenticated` (`0023:77`) | closed |
| T-05-15 | Repudiation | FY change with no attributable record | high | mitigate | Write uses the session-scoped `createClient()` (publishable key, `lib/supabase/server.ts:18`), never the privileged ingest writer, so `auth.uid()` resolves inside the definer trigger | closed |
| T-05-16 | Information Disclosure | Raw Postgres constraint names leaking into the form | medium | mitigate | `friendlyFinancialYearErrorMessage` returns one of two exported constants on every path (`lib/settings/errors.ts:37,39`); raw text `console.error`-only | closed |
| T-05-17 | Denial of correctness | Stale FY boundary on metric pages after a save | medium | mitigate | `revalidatePath` for `/settings/general` + all five metric routes in one round trip (`general/actions.ts:70-75`); UAT test 7 | closed |
| T-05-18 | Denial of correctness | Edit/delete leaving 2026-08-13 uncovered | critical | mitigate | Both RPCs evaluate data-window coverage before and after the write and `raise … using errcode = 'check_violation'` on a covered→uncovered transition (`0025:69,102,163,168,211,229,235`); UAT test 6 confirmed the refusal live | closed |
| T-05-19 | Repudiation | Backdated rate edit restating history with no trail | critical | mitigate | UPDATE path writes an explicit `pricing_tier_audit` row with `auth.uid()` (`0025:149`), since the AFTER INSERT trigger does not fire on UPDATE; D-18 dialog requires acknowledging the day count | closed |
| T-05-20 | Elevation of Privilege | `SECURITY DEFINER` RPCs callable anonymously | high | mitigate | `revoke execute` from `public` + `anon`, `grant execute` to `authenticated` only on both (`0025:179-181,243-245`); no broad UPDATE/DELETE RLS policy opened | closed |
| T-05-21 | Tampering | `search_path` hijack on a definer function | high | mitigate | `set search_path = public` pinned in both definitions (`0025:53,192`) | closed |
| T-05-22 | Tampering | Malformed date from the restate-count field reaching a query | medium | mitigate | `isValidCalendarDate` (`lib/pricing/calendar-date.ts`) — shape regex + genuine `Date.UTC` component round trip; both arguments validated (`pricing/actions.ts:183,186`) | closed |
| T-05-23 | Tampering | Partially-applied edit leaving stale/missing tier rows | high | mitigate | Whole UPDATE path is one PL/pgSQL function body (single transaction); deferred contiguity trigger re-validates at COMMIT | closed |
| T-05-24 | Information Disclosure | Raw constraint names reaching the pricing form | medium | mitigate | `mapPricingSaveError` / `mapPricingDeleteError` total over input, returning exported constants only (`lib/pricing/errors.ts:88,106`); raw text `console.error`-only | closed |
| T-05-25 | Tampering | False-positive "done" with no push | critical | mitigate | 05-05 [BLOCKING] gate applied 0023-0026 to the live project and ran the SQL assertions as the authoritative check | closed |
| T-05-26 | Information Disclosure | New tables readable without a session / functions bypassing RLS | high | mitigate | Post-push confirmation of `relrowsecurity`, `security invoker` on `revenue_total_for_period`, execute revoked from `anon` on all three, plus a clean `supabase db advisors --type security` pass bar one documented advisory (AR-08) | closed |
| T-05-27 | Denial of correctness | Revenue priced off wrong rates / ladder over aggregate volume | critical | mitigate | Live run asserted 45450.0000 exactly against seeded rows, all six band boundaries, and the per-month-vs-aggregate difference | closed |
| T-05-28 | Tampering | PostgREST resolving the wrong `save_pricing_tier_set` overload | high | mitigate | Post-push check asserts the 3-argument form no longer exists; regenerated types bind the 4-argument signature | closed |
| T-05-29 | Repudiation | Placeholder tier set disappearing with no record | medium | mitigate | 0026 writes a `pricing_tier_audit` row naming each removed set before deleting; `ON DELETE SET NULL` preserves the summary text | closed |
| T-05-30 | Tampering | Untyped RPC calls surviving type regeneration | medium | mitigate | Gate fails while any `supabase.rpc as unknown` cast remains; no such cast present in the pricing actions or the revenue page | closed |
| 05-06/T-05-17 | Information Disclosure | `friendlyFinancialYearErrorMessage` widening its match set | medium | mitigate | Every return path yields one of two exported constants; no path builds a string from input; 7-case suite asserts set membership (`lib/settings/__tests__/errors.test.ts`) | closed |
| 05-06/T-05-18 | Information Disclosure | New unscoped read bypassing RLS | low | mitigate | Reads `v_reconciliation_inventory_daily` (`security_invoker = on`, 0019/0022) through the same session-scoped client; no new SQL object, grant or privileged client | closed |
| 05-06/T-05-19 | Repudiation | Summary figure presented with no stated basis | high | mitigate | Both figures carry an as-of caption naming the real day; unknown renders as unknown, not zero; exact-copy greps + UAT test 8 period-invariance check | closed |
| 05-06/T-05-20 | Tampering | Future edit silently re-scoping the figures to the period | medium | mitigate | Comment-filtered `.gte(` count gate pins the file at exactly four period predicates; removed prop names banned tree-wide; P-07 rationale recorded in-code | closed |
| T-05-07-01 | Tampering | `savePricingTierSet` confirmation dialog mistaken for the boundary | high | mitigate | Dialog is UX-only; action re-parses with `pricingTierSetSchema` (`pricing/actions.ts:49`), keeps the session-scoped client, and still hits the 0025 guard | closed |
| T-05-07-02 | Tampering | `countRestatedDays` inclusive-end argument | medium | mitigate | Both arguments validated by `isValidCalendarDate`; today-UTC clamp and inverted-range short circuit retained | closed |
| T-05-07-03 | Information disclosure | Pricing error mapping | medium | mitigate | Mappers total over input; unrecognised raw message returns a constant containing no substring of the input; raw text stays server-side | closed |
| T-05-07-04 | Repudiation | Pricing tier audit trail | high | mitigate | Untouched by design; both write paths keep the session-scoped client so `auth.uid()` reaches the audit insert | closed |
| T-05-07-05 | Denial of service | Data-window coverage guard | high | mitigate | Guard remains the authority on save and delete; message and tone unchanged | closed |
| T-05-08-01 | Elevation of privilege | `app/(dashboard)/layout.tsx` | high | mitigate | `MobileNavBar` renders strictly below the `getUser()` guard and its `redirect('/login')` (`layout.tsx:30-37,54`); guard block untouched | closed |
| T-05-08-03 | Denial of service | Sticky header stacking trapping interaction | low | mitigate | UAT test 1 confirmed readability at 375px; nav reachability closed via G-05-OBS1 / 05-08 | closed |
| T-05-09-01 | Tampering | Pricing authority moved by a tier-set edit | high | mitigate | `resolveEditImpact` now computes `supersedes` from the crossed neighbour (`lib/pricing/restate-scope.ts:158,178,197`); pinned by unit tests in both crossing directions; hand-traced against 0012 in 05-REVIEW round 3; UAT test 10 | closed (residual disclosure gap AR-09) |
| T-05-09-02 | Tampering | Confirmation dialog treated as a security control | high | mitigate | Dialog is disclosure-only; a direct action call still hits Zod re-validation, `getUser()`, the UNIQUE constraint and the 0025 guard | closed |
| T-05-09-03 | Tampering | `countRestatedDays` date arguments | medium | mitigate | `Date.parse` guard replaced by a genuine UTC component round trip that rejects `2026-02-30`; both arguments validated | closed |
| T-05-09-04 | Repudiation | Pricing tier audit trail | high | mitigate | Untouched; session-scoped client retained on both write paths | closed |
| T-05-09-06 | Denial of service | Data-window coverage guard | high | mitigate | No migration added or modified; 0025 still refuses an edit that would uncover 2026-08-13 even after operator confirmation | closed |
| T-05-08-02 | Information disclosure | `components/app-shell/mobile-nav-bar.tsx` | low | accept | AR-01 — exposes only the product mark and a toggle; the labels are already in the client bundle and name guarded routes | closed |
| T-05-09-05 | Information disclosure | Pricing error mapping | medium | accept | AR-02 — no mapper modified by 05-09; WR-01 guarantee carried forward unchanged | closed |
| T-05-SC (05-01) | Tampering | npm/pip/cargo installs | low | accept | AR-03 — no new npm dependency; `select` is a shadcn CLI copy-in from the official registry, reviewed as source in the diff | closed |
| T-05-SC (05-02…05-09) | Tampering | npm/pip/cargo installs | low | accept | AR-04 — no package installs in plans 05-02 through 05-09; every added module is first-party TypeScript against dependencies already in `package.json` | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above `workflow.security_block_on` (high) count toward `threats_open`*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-05-08-02 | Mobile nav bar exposes only the product mark, a toggle, and route names already present in the client bundle; every named route is itself guarded. | Mark W | 2026-09-10 |
| AR-02 | T-05-09-05 | 05-09 modifies no error mapper; `lib/pricing/errors.ts` and its total-with-generic-fallback tests are untouched. | Mark W | 2026-09-10 |
| AR-03 | T-05-SC (05-01) | No new npm dependency in 05-01; the shadcn `select` copy-in came from the official registry and was reviewed as source in the diff. | Mark W | 2026-09-10 |
| AR-04 | T-05-SC (05-02…05-09) | No package-manager installs across plans 05-02 to 05-09; all new modules are first-party TypeScript against existing dependencies. | Mark W | 2026-09-10 |
| AR-08 | T-05-26 | `authenticated_security_definer_function_executable` advisory on `save_pricing_tier_set` is the documented consequence of 0025's deliberate `SECURITY DEFINER` choice (the UPDATE path must write `pricing_tier_audit`, which has no client INSERT policy). `search_path` is pinned; no RLS-bypass or mutable-search_path advisory appeared. | Mark W | 2026-09-10 (05-05) |
| AR-09 | T-05-09-01 | Residual under-disclosure in the edit-supersede dialog, recorded as WR-08/WR-09/WR-02 in `05-UAT.md` § Known Open. With 3+ tier sets the dialog may not name a further displaced set, and an exact-date collision can produce self-referential copy. The affected-day count and the server-side gate stay correct — neither can misprice revenue. Deferred to a deliberate tier-editor save-path design review rather than a fourth patch. | Mark W | 2026-09-10 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-10 | 50 | 50 | 0 | /gsd-secure-phase (orchestrator, ASVS L1, register authored at plan time) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-10
