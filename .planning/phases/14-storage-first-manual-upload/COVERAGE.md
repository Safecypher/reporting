# API Coverage — Supabase Storage (storage-js 2.112.3, via @supabase/supabase-js)

> Full coverage by default. Opt-outs are explicit, reasoned decisions.
> Scope: the Storage capabilities Phase 14's storage-first manual upload touches. Supabase Auth
> and PostgREST usage is unchanged from earlier phases. Supabase MCP is the orchestrator's
> migration tool, not an integration this phase ships.

| capability | decision | reason |
|---|---|---|
| createSignedUploadUrl | INTEGRATE | |
| uploadToSignedUrl | INTEGRATE | |
| info | INTEGRATE | |
| download | INTEGRATE | |
| remove | INTEGRATE | |
| list | INTEGRATE | |
| upload | INTEGRATE | |
| copy | OPT-OUT | not needed yet — contingent claim-latency lever chosen (or not) from deployed measurements in 14-07 Task 1; would be its own gap plan |
| move | OPT-OUT | explicitly out of scope — recordFile writes to reports and the claim removes the inbox object afterwards, which keeps the D-15 "object stays until a terminal outcome" invariant |
| exists | OPT-OUT | not needed — info answers existence and size in one call |
| resumable upload (TUS) | OPT-OUT | not needed yet — D-07 research chose plain signed upload with a fresh-URL retry (D-13); TUS stays the contingency behind lib/upload/transfer.ts if the ~49 MiB (near the D-20 50 MiB cap) deployed transfer fails |
| createSignedUrl (signed download) | OPT-OUT | not needed — every download is server-side with the secret key; no browser ever reads the inbox or reports |
| getPublicUrl | OPT-OUT | explicitly out of scope — both buckets are private |
| bucket management API (updateBucket) | OPT-OUT | not needed — the inbox file_size_limit is set by migration 0052 and verified on the live catalog |
