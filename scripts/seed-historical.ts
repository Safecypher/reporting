/**
 * Repeatable historical-data seed (D-07).
 *
 * Reads every `*.csv` file in `seed-data/` and ingests it through the exact
 * same shared pipeline the live upload path uses — `ingest()` from
 * `lib/ingestion/index.ts`, backed by the real Supabase writer
 * (`createSupabaseWriter()`). There is no parallel insert/dedup logic here:
 * idempotency comes entirely from the sha256 dup-file short-circuit and the
 * `row_hash` UNIQUE constraint that `ingest()`/`createSupabaseWriter()`
 * already enforce (T-07-01).
 *
 * Usage:
 *   npm run seed
 *
 * Requires `.env.local` with NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SECRET_KEY (same as the live upload path) — the `seed` npm
 * script loads it via `node --env-file=.env.local`.
 */
import { WebSocket as WsWebSocket } from "ws";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// Node 20 has no global WebSocket, but @supabase/supabase-js constructs a
// Realtime client (which requires one) eagerly in createClient — even though
// this seed never uses realtime. Next.js polyfills WebSocket in its runtime, so
// the live upload path works; a standalone script must supply it. Remove once
// the project moves to Node 22+ (which has a native global WebSocket).
if (!(globalThis as { WebSocket?: unknown }).WebSocket) {
  (globalThis as { WebSocket?: unknown }).WebSocket = WsWebSocket;
}
import { ingest } from "../lib/ingestion";
import { createSupabaseWriter } from "../lib/ingestion/supabase-writer";
import type { IngestionInput } from "../lib/ingestion/types";

const SEED_DATA_DIR = path.join(process.cwd(), "seed-data");

/**
 * `ingested_files.uploaded_by` is a FK to `auth.users(id)` — there is no
 * interactive session in a script context, so we cannot fabricate a uuid
 * (that would violate the FK, T-07-03 adjacent). Instead:
 *   - If SEED_UPLOADED_BY is set (a real seeded auth user's id, documented
 *     in seed-data/README.md), use it so the audit trail attributes the
 *     seed rows to a real account.
 *   - Otherwise fall back to null. `uploaded_by` must be nullable for this
 *     to work; if the live schema has it NOT NULL, set SEED_UPLOADED_BY
 *     before running the seed.
 */
const SEED_UPLOADED_BY = process.env.SEED_UPLOADED_BY ?? null;

async function main() {
  let files: string[];
  try {
    files = (await readdir(SEED_DATA_DIR)).filter((f) => f.toLowerCase().endsWith(".csv"));
  } catch {
    console.log(`No seed-data/ directory found at ${SEED_DATA_DIR} — nothing to seed.`);
    return;
  }

  if (files.length === 0) {
    console.log(`seed-data/ contains no CSV files — nothing to seed. See seed-data/README.md.`);
    return;
  }

  if (!SEED_UPLOADED_BY) {
    console.warn(
      "SEED_UPLOADED_BY is not set — seeded ingested_files rows will record uploaded_by=null. " +
        "Set SEED_UPLOADED_BY to a real auth user id to attribute seed rows to an account (see seed-data/README.md)."
    );
  }

  const deps = createSupabaseWriter();

  for (const fileName of files.sort()) {
    const filePath = path.join(SEED_DATA_DIR, fileName);
    const buffer = await readFile(filePath);

    const input: IngestionInput = {
      fileName,
      bytes: new Uint8Array(buffer),
      contentType: "text/csv",
      // IngestionInput.uploadedBy is `string | null` — the seed legitimately
      // passes null when no SEED_UPLOADED_BY is configured (nullable FK). No cast.
      uploadedBy: SEED_UPLOADED_BY,
    };

    const result = await ingest(input, deps);

    if (result.alreadyUploaded) {
      console.log(
        `${fileName}: already uploaded on ${result.alreadyUploaded.date} — skipped (idempotent, no re-parse)`
      );
      continue;
    }

    console.log(
      `${fileName}: reportType=${result.reportType ?? "unrecognised"} ` +
        `accepted=${result.accepted} duplicates=${result.duplicates} ` +
        `rejected=${result.rejected} excluded=${result.excluded}`
    );
    if (result.rejectReasons.length > 0) {
      for (const r of result.rejectReasons) {
        console.log(`  - row ${r.row}: ${r.reasons.join(", ")}`);
      }
    }
  }
}

main()
  .then(() => {
    console.log("Seed complete.");
  })
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  });
