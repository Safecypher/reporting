/**
 * Peak-memory bench for the two halves of ingestion (14-02).
 *
 *   node --import tsx --max-old-space-size=N scripts/bench-ingest-memory.mts FILE [--mode claim|process]
 *
 * mode "claim"   runs claimFile (the synchronous half: hash + classify + record).
 * mode "process" (default) runs processClaimedFile with report type "billing"
 *                (the background half: parse, validate, normalise, upsert).
 *
 * Everything runs against an in-memory IngestDeps: no network, no database.
 * Prints one JSON line { mode, bytes, rows, accepted, duplicates, rejected,
 * excluded, ms, peakRssMb } (plus reportType in claim mode), where peakRssMb is
 * process.resourceUsage().maxRSS (kilobytes) / 1024. These are local numbers,
 * not Netlify numbers; the deployed proof in 14-06 is what closes D-06.
 * Exits 1 on any thrown error.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { claimFile, processClaimedFile } from "../lib/ingestion/index";
import type { IngestDeps } from "../lib/ingestion/types";

function fail(message: string): never {
  console.error(`bench-ingest-memory: ${message}`);
  process.exit(1);
}

const argv = process.argv.slice(2);
let file: string | null = null;
let mode: "claim" | "process" = "process";
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--mode") {
    const m = argv[++i];
    if (m !== "claim" && m !== "process") fail("--mode must be claim or process");
    mode = m;
  } else if (!file) {
    file = argv[i];
  } else {
    fail(`unexpected argument ${argv[i]}`);
  }
}
if (!file) fail("usage: bench-ingest-memory.mts FILE [--mode claim|process]");

/**
 * 52-bit key hash (two FNV-1a style 32-bit lanes, 26 bits kept from each).
 * The fake database must not dominate what this bench measures: a
 * Set<string> of ~1M transaction ids costs ~150 MB on its own: 763 MB peak RSS
 * at a 600 MB heap with it against 550 MB with this compact key, and a 200 MB
 * heap died with it but passes (464 MB) without. The processor is the thing
 * under test; the real table lives in Postgres. A collision would only make
 * the fake report one extra duplicate (compare `accepted` with `rows`).
 */
function keyHash(key: string): number {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b + c, 0x85ebca6b) ^ (b >>> 13);
  }
  return (a >>> 6) * 67108864 + (b >>> 6);
}

/** In-memory deps: de-duplicates on the conflict column like the real UNIQUE constraint would. */
function makeDeps(): IngestDeps {
  const seen = new Set<number>();
  return {
    async findFileByHash() {
      return null;
    },
    async recordFile() {
      return "bench-file";
    },
    async upsertVerifications(rows) {
      return rows.length;
    },
    async upsertRows(table, rows, opts) {
      let inserted = 0;
      for (const row of rows) {
        const key = keyHash(`${table}|${String(row[opts.onConflict])}`);
        if (!seen.has(key)) {
          seen.add(key);
          inserted++;
        }
      }
      return inserted;
    },
    async finalizeFile() {
      // counts are returned by processClaimedFile itself
    },
  };
}

try {
  const buf = readFileSync(file);
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const deps = makeDeps();
  const started = Date.now();

  let counts = { accepted: 0, duplicates: 0, rejected: 0, excluded: 0 };
  let reportType: string | null = null;

  if (mode === "claim") {
    const result = await claimFile({ fileName: basename(file), bytes, uploadedBy: null }, deps);
    if (result.kind !== "claimed") throw new Error(`claimFile returned ${result.kind}, expected claimed`);
    reportType = result.claim.reportType;
  } else {
    const result = await processClaimedFile(
      { ingestedFileId: "bench-file", reportType: "billing", bytes, fileName: basename(file) },
      deps
    );
    counts = {
      accepted: result.accepted,
      duplicates: result.duplicates,
      rejected: result.rejected,
      excluded: result.excluded,
    };
  }

  const ms = Date.now() - started;
  const rows = counts.accepted + counts.duplicates + counts.rejected + counts.excluded;
  const peakRssMb = Math.round(process.resourceUsage().maxRSS / 1024);
  console.log(
    JSON.stringify({
      mode,
      bytes: bytes.length,
      rows,
      ...counts,
      ms,
      peakRssMb,
      ...(reportType ? { reportType } : {}),
    })
  );
} catch (err) {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
}
