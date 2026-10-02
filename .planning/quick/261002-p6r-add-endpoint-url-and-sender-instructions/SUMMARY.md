---
quick_id: 261002-p6r
slug: add-endpoint-url-and-sender-instructions
date: 2026-10-02
status: complete
files_modified:
  - lib/push/endpoint.ts (new)
  - lib/push/__tests__/endpoint.test.ts (new)
  - components/settings/endpoint-instructions.tsx (new)
  - components/settings/token-reveal-dialog.tsx
  - components/settings/mint-credential-form.tsx
  - app/(dashboard)/settings/senders/page.tsx
commits:
  - 44041c5
---

# Summary — endpoint URL and sender instructions on /settings/senders

## The gap

Issuing a credential gave you the token and nothing else. Everything a sender
actually needs — the endpoint URL, that the parts must be named `file`, the 25MB
cap, the 202/207/400/401 matrix — lived only in `app/api/push/route.ts` and the
README. Whoever onboarded a sender had to reconstruct it from the code, at the one
moment they could least afford to get it wrong, since the token is shown once.

## Two surfaces, answering different questions

1. **A persistent "What to send a sender" panel** on `/settings/senders`. Always
   re-readable, unlike the token. Endpoint, Bearer header, field name, size cap,
   response matrix, plus a Copy instructions button.
2. **"Copy token + instructions" inside the reveal dialog.** That dialog is the
   *only* moment the complete message can be assembled — the token is unrecoverable
   once it closes (D-05) — so the one-paste onboarding message belongs there, not
   only on the page behind it.

## Why the strings are in lib/, not in the component

`lib/push/endpoint.ts` holds the contract with 13 tests. The published integration
details are the kind of thing that silently drifts from the route it describes; the
tests assert the field name, the cap and all four status codes against the real
values. One test is specifically about honesty: the "shown once and cannot be
retrieved again" line appears **only** when a token is actually present, so the
re-sendable form never implies a token can be looked up later.

## Decisions

- **`pushEndpointUrl` returns null rather than a half-built URL** when
  `NEXT_PUBLIC_SITE_URL` is unset. Both surfaces then render what to fix. A sender
  may paste whatever we show them, so a partial URL is worse than visibly having
  none.
- **The instructions say a 202 means the file ARRIVED, not that it parsed.**
  Delivery and interpretation are deliberately separate concerns in this design
  (it is why inline ingestion in the push endpoint was rejected), and conflating
  them is how a parse failure gets read as a delivery failure and re-sent.
- **The full message goes to the clipboard and nowhere else** — never stored,
  logged, or put in the URL, matching the existing token-handling discipline.

## Verification

- `npx tsc --noEmit`, `npx eslint`, `npm run build` — clean
- `npm test` — 45 files/732 tests -> **46 files/745 tests**

## Not verified

Visual check on the deployed page, and a real clipboard copy in a browser —
`navigator.clipboard` is stubbed by neither test nor build here.
