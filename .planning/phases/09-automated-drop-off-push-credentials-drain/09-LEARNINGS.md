---
phase: 09
phase_name: "automated-drop-off-push-credentials-drain"
project: "Safecypher Reporting"
generated: "2026-09-29"
counts:
  decisions: 7
  lessons: 8
  patterns: 6
  surprises: 5
missing_artifacts: []
---

# Phase 09 Learnings: Automated Drop-Off — Push, Credentials & Drain

## Decisions

### `push_credentials.sender` deliberately carries no UNIQUE constraint
A sender may hold more than one live credential at once, so rotation is "issue new → sender
switches when ready → revoke old" with no flag-day. The design doc's own
`sender text not null unique` line was superseded, and both the table and column comments say
so explicitly to stop a future editor "fixing" it.

**Rationale:** Adding the constraint later requires deleting a live credential an external
sender may still be using. The cost of the constraint is paid at exactly the wrong moment.
**Source:** 09-01-SUMMARY.md, `supabase/migrations/0040_push_delivery_spine.sql`

### Delivery rejections live in their own table, not as `ingested_files` rows
A refused delivery and a failed parse are different statements. `push_rejections` keeps them
apart, and the migration's comments name the zero-byte-collision forcing fact directly.

**Rationale:** Two identical refusals must not collapse into one row, because "this sender has
failed every morning this week" is the signal the table exists to make visible.
**Source:** 09-02-SUMMARY.md, D-14

### `distinctSenders` includes senders whose credentials are all revoked
The sender-name chip row suggests previously-used names, live or not.

**Rationale:** The chip row exists to prevent an accidental near-duplicate sender identity, and a
name that once existed serves that purpose as well as a currently-live one.
**Source:** 09-03-SUMMARY.md

### Exactly one cron job for drain + freshness; a second job for profile resync is allowed
0043 states "EXACTLY ONE JOB" for the drain, because a freshness check firing before its drain
reports a false absence (D-4). 0045 adds a second job anyway, with a written argument for why
the rule does not extend to it.

**Rationale:** The one-job rule is scoped to an ordering hazard between drain and freshness.
Profile resync shares no state and no ordering relationship with either; folding it in would
couple identity refresh to a daily ingest window and make it run once a day instead of hourly.
**Source:** 09-06-TASK2-RECORD.md, `supabase/migrations/0045_profiles.sql`

### `mergeHistory`'s uploader-email parameter is REQUIRED, not optional
Costing ~11 mechanical test call-site updates.

**Rationale:** The bug being fixed (G-09-1) was a caller silently supplying nothing. An optional
parameter with a default leaves that exact failure shape available; a required one makes the
compiler refuse it.
**Source:** 09-06-PLAN.md, 09-06-SUMMARY.md

### Identity resolution: a mirrored `profiles` table, chosen over an on-demand resolver
Mark chose this at the UAT-close checkpoint, from four options.

**Rationale:** It fixes `/uploads` and the three settings surfaces together and gives every future
"who did this" surface something to join against, rather than solving the same problem a fifth
time.
**Source:** 09-UAT.md, 09-06-PLAN.md

### The live-proof rows stay in production as an audit trail
2 `ingested_files`, 5 `verifications`, 2 `push_rejections`, and a `no_source_data` reconciliation
row.

**Rationale:** They are real, correctly-labelled data, and the reconciliation row is honestly
reporting "counterpart not yet arrived" rather than a false mismatch. Deleting them would remove
the evidence the phase ran against production at all.
**Source:** 09-UAT.md

---

## Lessons

### A locked decision can be physically impossible, and the plan must stop rather than substitute
09-06 specified a trigger on `auth.users`. It cannot be created on this project by any route:
`auth.users` is owned by `supabase_auth_admin`, `postgres` is not a member, and the SQL editor,
MCP and CLI all connect as `postgres`. The plan's explicit halt condition ("do not substitute a
view, an RPC, or a client-side sync") is what turned a dead end into a decision Mark made in
about a minute, instead of a mechanism silently swapped without him knowing.

**Context:** The first apply returned `42501: must be owner of relation users` and rolled back
whole. Writing the halt condition into the plan BEFORE it was needed is what made this cheap.
**Source:** 09-06-TASK2-RECORD.md, 09-06-PLAN.md

### Human UAT caught what every automated gate missed
G-09-1 — `/uploads` reading "Manual — unknown user" instead of naming the uploader — survived
`npm test` 587/587, clean `tsc`, clean lint, a full code review, a passing phase verification, and
five pinned manual-path blob hashes. All of them were right: the identity WAS captured correctly
and read correctly. It was discarded one layer before render, in a line no gate was looking at.

**Context:** The first UAT question of the session found it. Every automated signal said the
manual path was byte-identical, and in the files they checked it was.
**Source:** 09-UAT.md test 1, 09-VERIFICATION.md

### A column-level REVOKE is a silent no-op against Supabase's default table-wide grant
Established in 0042, re-applied deliberately in 0045: `revoke all ... from anon, authenticated`
FIRST, then `grant select (id, email)`. Postgres warns rather than errors, so the migration
"succeeds" while the control is never in force. Revoke ALL, not just SELECT, because TRUNCATE is
not row-level and RLS does not govern it (0044's lesson).

**Context:** Only a live catalog read catches this. The migration text looks correct either way.
**Source:** `supabase/migrations/0045_profiles.sql`, 09-06-TASK2-RECORD.md

### A case-mismatched Vault secret name fails silently, forever
The plan said `drain_cron_secret`; the secret exists as `DRAIN_CRON_SECRET`. `vault.secrets`
names are case-sensitive and a missed lookup returns NULL, not an error — and `'Bearer ' || NULL`
is NULL. The job would have posted an empty Authorization header and collected a silent 401 every
day at 16:00 until someone asked why nothing had drained.

**Context:** Caught only because the Vault lookup returned zero rows during live verification.
**Source:** 09-05-SUMMARY.md

### The Supabase CLI writes its error to stdout, so `gen types > types/db.ts` destroys the file
The CLI cannot authenticate in this environment. The documented command
`supabase gen types typescript --linked > types/db.ts` would have overwritten `types/db.ts` with a
one-line error JSON and exited 1. Hit twice — 09-05 and again in 09-06.

**Context:** Generate to a temp file and inspect before moving it into place. The MCP generator is
the working fallback, with one accepted consequence: it emits only the `public` schema, so the
`graphql_public` block is gone (referenced nowhere; `tsc` clean).
**Source:** 09-05-SUMMARY.md, 09-06-TASK2-RECORD.md

### "The fix doesn't work" and "you're not looking at the fix" are indistinguishable from the user's side
G-09-1's first re-test reported the bug still present. It wasn't: no dev server was running and
Netlify was 11 commits behind, so the build under test predated the fix entirely. Establishing
that cost a full diagnostic pass across data, grants, PostgREST and code.

**Context:** Worth checking WHICH BUILD is under test before investigating the code, when a fix is
committed locally but unpushed. A PostgREST `42501` rather than `PGRST205` was the useful signal
that ruled out the schema-cache class entirely.
**Source:** 09-UAT.md test 1 note

### A verification fingerprint goes stale when you apply the verification's own advice
`09-VERIFICATION.md` fingerprints 52 covered files including `REQUIREMENTS.md`. Its own advisory
finding was "flip AUTO-07 to Complete" — in `REQUIREMENTS.md`. Doing so invalidated the digest and
blocked the completion predicate.

**Context:** Resolvable by re-stamping with the previous digest, the exact scope of the change, and
why the verdict is unaffected — but it must be written down, because re-stamping a fingerprint is
precisely the move that could hide real drift.
**Source:** 09-VERIFICATION.md `covered_digest_restamped`

### Test fixtures can collide with the validation they predate
`new Uint8Array(5 * 1024 * 1024)` is zero-filled, and 09-02's new NUL-sniff check correctly flags
an all-zero buffer as unrecognised binary — so the pre-existing "exactly 5MB is accepted" boundary
test failed. Not a bug in `acceptPush`: a fixture that happened to construct exactly what the new
check exists to catch.

**Context:** Fixed with `.fill(0x41)` and a comment noting the test exercises size, not format.
**Source:** 09-02-SUMMARY.md

---

## Patterns

### Checkpoint the work an executor structurally cannot do
Executors in this project have no Supabase MCP access. Plans that need a live migration split into
`auto` tasks (write the file) and a `checkpoint:human-action` task carrying explicit orchestrator
instructions. Used by 06-09, 09-05 and 09-06.

**When to use:** Any task requiring a credential, session or tool the executor does not hold.
Encoding it as a checkpoint beats an executor discovering the gap and improvising.
**Source:** 09-06-PLAN.md Task 2

### Verify against the live catalog, never against the SQL you just applied
0040's token-digest revoke reported success and did nothing. Every migration since carries a
read-only catalog verification whose expected output is stated in advance — and the record pastes
ACTUAL returned rows, not "as expected".

**When to use:** Every migration touching grants, RLS or policies.
**Source:** 09-06-TASK2-RECORD.md, 09-05-SUMMARY.md

### Pinned blob hashes as a regression gate on an untouched path
The phase goal's second half — "the manual path keeps working exactly as before" — is enforced by
pinning git blob hashes of five files and re-measuring them at verification.

**When to use:** When a phase must prove it did NOT change something. Note the limit this phase
found: hashes prove the pinned files are identical, not that the behaviour they participate in is
unchanged. G-09-1 lived in a file that was legitimately modified.
**Source:** 09-VERIFICATION.md, 09-UAT.md test 1

### Route-handler tests via `vi.mock` + `importOriginal` merge
Test the real route with an in-memory fake for only the client constructor, keeping real
`isXlsx` / `detectContentType` / `sanitiseFileName`.

**When to use:** Any route that constructs its own Supabase client. Established in 09-02 and
reused by 09-03/09-04.
**Source:** 09-02-SUMMARY.md

### One resolver, many surfaces — fix the capability, not the symptom
G-09-1 surfaced in four places at once because the id→email capability did not exist. The fix added
it once (`lib/identity/profiles.ts`) and wired all four call sites to it; no page carries its own
fallback string.

**When to use:** When the same defect appears in several files, check whether it is one missing
capability rather than N bugs.
**Source:** 09-06-SUMMARY.md, 09-07-SUMMARY.md, 09-GAP-REVIEW.md

### Absence as a first-class normal case
Because sync is hourly cron rather than a trigger, a user can legitimately be missing from
`profiles`. Every call site degrades to `UNKNOWN_ACTOR_LABEL` — never throws, never renders a raw
uuid, never takes a page to its error state.

**When to use:** Any eventually-consistent lookup. Decide the unresolved rendering once, centrally,
and make absence unremarkable.
**Source:** `lib/identity/profiles.ts`, 09-GAP-REVIEW.md

---

## Surprises

### The planned mechanism was not merely hard — it was unreachable
Not a permissions toggle, not a config change: `pg_has_role('postgres','supabase_auth_admin','MEMBER')`
is false, and every route into the database is `postgres`. The classic Supabase `handle_new_user`
trigger pattern is unavailable on this project.

**Impact:** Forced a mid-execution decision from Mark and a rewritten migration. Cost roughly one
checkpoint; would have cost far more if discovered after the mechanism shipped.
**Source:** 09-06-TASK2-RECORD.md

### The uploads are attributed to a personal address, not a work one
`ingested_files.uploaded_by` resolves to `mark@gromski.com`, while the other profiles are
`@safecypher.com` (`mark.phillips`, `travis.mills`, `richard.pickard`).

**Impact:** None functionally — the label is correct. Noted because "Manual — mark@gromski.com" may
not read the way leadership expects on a Safecypher dashboard.
**Source:** live `ingested_files` / `profiles` query, 2026-09-29

### Stale doc comments are this phase's most recurrent defect class
Three separate instances: 09-03's placeholder comment surviving the code it described, and two in
the gap-closure review where a comment called a defect outstanding that the sibling plan had
already fixed.

**Impact:** Zero runtime impact each time, but it is the one finding type that recurred in every
review. Comments describing a *plan* ("Task 3 fills this", "migrating them is 09-07's job") go
stale the moment that plan lands.
**Source:** 09-03-SUMMARY.md, 09-GAP-REVIEW.md

### The TDD RED gate cannot read this project's test output
`gsd_run check tdd-red-evidence` parses `node --test`'s `# tests/# pass/# fail` trailer, which
vitest's TAP reporter never emits — so it returns `INVALID_RED (zero_tests_discovered)` regardless
of genuine RED evidence.

**Impact:** RED had to be verified by hand (5 distinctly-named failures, 26 passes, no load
crashes). A GSD tooling gap, not a defect in the work, but it means the RED evidence here is
human-readable rather than machine-gated.
**Source:** 09-06-SUMMARY.md

### Unpushed local commits silently downgrade the whole execution model
`worktree.base-check` returned `shouldDegrade: true` because local `main` was ahead of
`origin/HEAD`, so harness worktrees would fork from a stale base. The phase ran sequentially
throughout.

**Impact:** None here — the two gap-closure plans were strictly sequential anyway. It would matter
on a phase with genuinely parallel waves. Cleared the moment the work was pushed.
**Source:** `worktree.base-check`, this session's execution log
