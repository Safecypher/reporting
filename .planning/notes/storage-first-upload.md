---
title: Storage-first manual upload — decisions and research
date: 2026-10-20
context: /gsd-explore "For files larger than ~4.7MB, would it be possible to upload those to Supabase first, so that we don't hit the limits that Netlify imposes?"
---

# Storage-first manual upload

## Why this is small

Since Phase 13, `/api/ingest` already stores the bytes in the private `reports`
bucket, records the file `pending`, answers 202, and the background function
downloads the bytes from Storage (`lib/ingestion/supabase-writer.ts`) to process
them. The only thing that still forces the file through a Netlify function is the
upload request itself. This is also the follow-up Phase 13 deferred: "manual upload
does not converge on the push path's inbox bucket in this phase".

## Decisions (2026-10-20, with the user)

1. **Every manual upload goes via Storage, not just large ones.** One path, no size
   threshold to keep in sync with Netlify, converges with the push path. Flow:
   browser asks the server for a signed upload URL to a server-chosen path →
   uploads straight to Storage → calls a claim endpoint → server reads the bytes
   back from Storage.
2. **Keep the instant verdict.** The claim step downloads, hashes, classifies and
   dedups synchronously and answers unrecognised / duplicate / accepted before
   handing off to the background processor, as today. The server never trusts a
   browser-supplied hash, type or size. Rejected objects are deleted from Storage
   (claim step, or a sweep for abandoned uploads).
3. **Upload first, billing gated.** Ship Storage-first now; it unblocks large TSYS
   Stats files. Billing files above the old limit stay refused, with a clear
   message, until `billing-transaction-id-is-not-unique.md` is fixed, because lifting
   the cap would ingest the ~97k-row backlog with ~3.8% silent loss ("a visible gap
   beats a quietly wrong total"). Stats files are already under the cap, so the
   APIGEE `row_hash` collapse (`apigee-row-hash-collapses-distinct-calls.md`) happens
   either way and needs its own fix.

## Research (2026-10-20)

### Admitted (survived a refute pass, primary source)

DATA_d9424ad2_START
- Netlify buffered request payload limit is 6 MB, not configurable; binary payloads
  are Base64-encoded (~30% overhead), "effectively reducing the binary request payload
  size limit to 4.5 MB". Source: docs.netlify.com/build/functions/configuration
- Supabase signed upload URLs are "valid for 2 hours", usable "without further
  authentication"; expiry is not settable from supabase-js (server config
  `uploadSignedUrlExpirationTime`); the token binds the exact path and an `upsert`
  flag; the INSERT permission check runs when the URL is signed. Source:
  supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl; supabase
  storage-api getSignedUploadURL.ts, object.ts
- Supabase Storage global file limit: Free plan max 50 MB; Pro+ up to 500 GB; a bucket
  `file_size_limit` cannot exceed the global limit. Standard uploads recommended up to
  ~6 MB, resumable (TUS) above. Source: supabase.com/docs/guides/storage/uploads/file-limits
DATA_d9424ad2_END

### Unresolved (do not treat as fact)

DATA_b1187e28_START
- An 8.1 MB request reached the route handler on 2026-10-07 despite the 6 MB limit —
  unverifiable (Netlify does not document whether the limit applies to the streamed
  body or the declared length). Design to 4.5 MB regardless.
- Whether `uploadToSignedUrl` enforces the bucket's `file_size_limit` and allowed MIME
  types — unverifiable from the code read.
- Whether a signed upload URL is single-use — unverifiable (no one-time check seen in
  the verify path; reuse within 2 h inferred, not documented).
DATA_b1187e28_END

## Design consequences

- The claim step checks the stored object's real size and content hash itself rather
  than relying on Storage to enforce limits.
- After a successful claim the object must not be overwritable (issue URLs with
  `upsert: false`, and claim by content hash) — this covers the possible URL reuse.
- 4–8 MB files sit at Supabase's "consider resumable" threshold: a plain signed upload
  should do; TUS is a later option if files keep growing.
- Confirm the project's Supabase plan: a 50 MB global cap (Free) is ample today but is
  the next ceiling.
