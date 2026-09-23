# Phase 5 — API Coverage

No external API integration: the phase touches only the existing internal Supabase/Postgres platform plus Next.js, react-hook-form and Zod, all already in package.json — nothing third-party is added.

Detail: the phase adds one `app_settings` table, three SQL functions and one data seed, and consumes them from Next.js App Router Server Components. No new npm dependency, third-party service SDK, endpoint, webhook or credential is introduced.
