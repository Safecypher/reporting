/**
 * Synthetic billing CSV generator (14-02).
 *
 * Writes the ten billing columns (BILLING_HEADER order) followed by random,
 * entirely synthetic rows until the byte count reaches the target. The target
 * is a FLOOR: the last batch can overshoot it slightly, so re-check the
 * printed `bytes` against 52,428,800 (the inbox bucket limit, D-20) when
 * generating files near 50 MiB.
 *
 * SAFETY (T-14-11): by default every timestamp falls BEFORE the DATA-06 cutoff
 * (2026-08-13T00:00:00Z), so a file from this script, uploaded to a deployed
 * site, writes zero rows to billing_transactions (every row counts as
 * `excluded`). --in-window moves timestamps after the cutoff for LOCAL
 * benchmarks only and must never be uploaded to the deployed site. No real
 * billing data is used or needed.
 *
 * Usage:
 *   node scripts/gen-synthetic-billing.mjs --target-mib 49 --out /tmp/b.csv
 *   node scripts/gen-synthetic-billing.mjs --target-mib 49 --in-window --out /tmp/b.csv
 *
 * Options:
 *   --target-mib N   required, 1..1024, minimum size in MiB
 *   --out PATH       required, output file
 *   --seed N         default 14, deterministic PRNG so runs are reproducible
 *   --in-window      emit 2026-08-13..2026-08-31 timestamps (LOCAL benchmarks only)
 *
 * Output: one JSON line { out, rows, bytes, window: "pre-window" | "in-window" }.
 * Only node built-ins are used.
 */
import { createWriteStream } from "node:fs";
import { once } from "node:events";

const BILLING_HEADER = [
  "timestamp",
  "transactionDate",
  "transactionTime",
  "processor",
  "issuerBank",
  "transactionId",
  "tokenReference",
  "authorised",
  "verificationKind",
  "region",
];

const MAX_BUCKET_BYTES = 52_428_800;
const CUTOFF_MS = Date.parse("2026-08-13T00:00:00Z");

function fail(message) {
  console.error(`gen-synthetic-billing: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { seed: 14, inWindow: false, targetMib: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in-window") args.inWindow = true;
    else if (a === "--target-mib") args.targetMib = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--seed") args.seed = Number(argv[++i]);
    else fail(`unknown argument ${a}`);
  }
  if (!Number.isFinite(args.targetMib) || args.targetMib < 1 || args.targetMib > 1024) {
    fail("--target-mib is required and must be between 1 and 1024");
  }
  if (!args.out) fail("--out is required");
  if (!Number.isInteger(args.seed)) fail("--seed must be an integer");
  return args;
}

/** mulberry32: small deterministic PRNG, so the same seed writes the same file. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const { targetMib, out, seed, inWindow } = parseArgs(process.argv.slice(2));
const rand = prng(seed);
const hex = (digits) => Math.floor(rand() * 16 ** digits).toString(16).padStart(digits, "0");

// Pre-window: 2026-07-01T00:00:00Z .. 2026-08-12T23:59:59Z (before the cutoff).
// In-window:  2026-08-13T00:00:00Z .. 2026-08-31T23:59:59Z.
const startMs = inWindow ? CUTOFF_MS : Date.parse("2026-07-01T00:00:00Z");
const endMs = inWindow ? Date.parse("2026-08-31T23:59:59Z") : CUTOFF_MS - 1000;

if (inWindow) {
  console.error(
    "WARNING: --in-window rows are AFTER the data-window cutoff. This file is for LOCAL benchmarks only and must never be uploaded to the deployed site."
  );
}

function row(counter) {
  const iso = new Date(startMs + Math.floor(rand() * (endMs - startMs))).toISOString(); // 2026-08-20T10:00:00.123Z
  const date = iso.slice(0, 10);
  const time = iso.slice(11, 19);
  return [
    iso,
    date,
    time,
    "SYNTHETIC",
    "Synthetic Bank",
    `synth-${counter.toString(36)}-${hex(4)}`, // unique per row: the counter alone guarantees it
    hex(6),
    rand() < 0.5 ? "True" : "False",
    "SYN",
    "XX",
  ].join(",");
}

const targetBytes = targetMib * 1024 * 1024;
const stream = createWriteStream(out);
let bytes = 0;
let rows = 0;

const header = BILLING_HEADER.join(",") + "\n";
stream.write(header);
bytes += Buffer.byteLength(header);

while (bytes < targetBytes) {
  const lines = [];
  for (let k = 0; k < 2000; k++) lines.push(row(rows + k));
  rows += lines.length;
  const chunk = lines.join("\n") + "\n";
  bytes += Buffer.byteLength(chunk);
  if (!stream.write(chunk)) await once(stream, "drain");
}
stream.end();
await once(stream, "finish");

console.log(JSON.stringify({ out, rows, bytes, window: inWindow ? "in-window" : "pre-window" }));
if (bytes > MAX_BUCKET_BYTES) {
  console.error(`WARNING: ${bytes} bytes exceeds the inbox bucket limit of ${MAX_BUCKET_BYTES}; do not upload this file.`);
}
