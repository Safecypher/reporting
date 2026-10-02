---
quick_id: 261002-po6
slug: hide-revoked-push-credentials-by-default
date: 2026-10-02
status: complete
files_modified:
  - lib/push/credentials.ts
  - lib/push/__tests__/senders.test.ts
  - components/settings/credentials-table.tsx
  - app/(dashboard)/settings/senders/page.tsx
commits:
  - 8dd4f0e
---

# Summary — revoked credentials hidden by default

## The ask, and what it turned into

"Delete the test tokens so they no longer show in the UI." Investigating first changed
the answer.

| Sender | Files | Rejections | Reality |
|---|---|---|---|
| `wri-test` | 0 | 0 | genuinely disposable |
| `phase-09-live-proof` | 1 | 2 | delivered `daily-ver-report_2026-09-27.csv`, ingested, `done` |
| `phase-09-cr01-recheck` | 1 | 0 | delivered `daily-ver-report_2026-09-26.csv`, ingested, `done` |

Two of the three "test" credentials delivered the **real daily verification reports for
26 and 27 September**. 21 verification rows from those two days are live in production
and feed the dashboard, revenue and reconciliation.

Both foreign keys into `push_credentials` are `ON DELETE NO ACTION`, so the database
would have refused the delete anyway — a deliberate guard, since a credential is the
provenance record for every file it delivered. Deleting would have required destroying
that provenance first, in a product whose stated core value is trustworthy revenue
reconciliation.

So: hide, don't delete. Which also turned out to be what was actually wanted.

## What changed

- `partitionByRevoked` in `lib/push/credentials.ts`, with 4 tests — including the case
  that is today's actual production state, every credential revoked.
- The page defaults to live credentials, with a "Show N revoked credentials" link. The
  filter is a URL search param, not client state: `CredentialsTable` is a Server
  Component and this needs no interactivity beyond a link.
- `CredentialsTable`'s empty state is parameterised. The default wording — "No push
  credentials yet" — is a lie when revoked rows exist and are merely hidden. With
  everything revoked the page now says exactly that, gives the hidden count, and says why
  they are kept.

## Not done

`wri-test` was not deleted. It is the one row that could be removed safely (no
referencing rows), but hiding revoked credentials covers it, and nothing is gained by a
production delete that the UI no longer needs.

## Verification

- `npx tsc --noEmit`, `npx eslint`, `npm run build` — clean
- `npm test` — **745 -> 749 tests**, all passing

Not verified: the rendered page. Worth confirming the toggle reads sensibly when all
three are hidden, since that is the state it will actually be seen in first.
