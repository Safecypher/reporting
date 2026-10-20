# Research Questions

Open questions that need deeper investigation. Append; mark answered ones with the date and source.

## Storage-first upload (from /gsd-explore, 2026-10-20 — see .planning/notes/storage-first-upload.md)

- [ ] Does `uploadToSignedUrl` enforce the bucket's `file_size_limit` and `allowed_mime_types`? (Research could not verify from the storage-api code it read. Test empirically against our bucket.)
- [ ] Are Supabase signed upload URLs single-use, or reusable for their 2-hour life? (No one-time check seen in the verify path; reuse inferred, not documented. Determines whether `upsert: false` + claim-by-hash is sufficient protection.)
- [ ] Which Supabase plan is this project on? Free caps every object at 50 MB globally; Pro allows up to 500 GB. Sets the next ceiling after Netlify's 4.5 MB.
- [ ] Why did an 8.1 MB request reach the route handler on 2026-10-07 despite Netlify's documented 6 MB buffered limit? (Unverifiable from Netlify docs. Moot if every upload bypasses the function, but worth knowing.)
