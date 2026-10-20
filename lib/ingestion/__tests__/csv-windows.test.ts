import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import { CSV_SLICE_BYTES, CSV_WINDOW_ROWS, csvWindows } from "../csv-windows";
import { processClaimedFile } from "../index";
import { billingHandler } from "../handlers/billing";
import type { ClaimedFile, IngestDeps, RejectedRow } from "../types";

/**
 * 14-02 Task 2: windowed CSV reading and windowed billing processing.
 * The contract is EQUIVALENCE with whole-file processing: windowing is a
 * memory optimisation and must never change a count, a reject row number
 * or a row (T-14-10).
 */

const encode = (s: string) => new TextEncoder().encode(s);
const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, name)));

/** The whole-file reference: exactly what billing parsing does today. */
function wholeFile(bytes: Uint8Array): Record<string, string>[] {
  const text = new TextDecoder("utf-8").decode(bytes);
  return Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true }).data;
}

async function collect(
  bytes: Uint8Array,
  windowRows: number
): Promise<{ rows: Record<string, string>[]; windows: Record<string, string>[][] }> {
  const windows: Record<string, string>[][] = [];
  for await (const w of csvWindows(bytes, windowRows)) windows.push(w);
  return { rows: windows.flat(), windows };
}

describe("csv window constants", () => {
  it("slices at 1 MiB and windows at 50,000 rows", () => {
    expect(CSV_SLICE_BYTES).toBe(1_048_576);
    expect(CSV_WINDOW_ROWS).toBe(50_000);
  });
});

describe("csvWindows equivalence with whole-file Papa.parse", () => {
  const tricky = encode(
    "﻿id,name,note\r\n" +
      '1,"Smith, J","plain"\r\n' +
      "\r\n" +
      '2,"multi\r\nline","quoted newline"\r\n' +
      "3,Zoë,café €5 \u{1F600}\r\n" +
      "\r\n" +
      '4,"say ""hi""",end\r\n'
  );
  const inputs: [string, Uint8Array][] = [
    ["BOM + CRLF + quoted commas + quoted newline + multibyte + blank lines", tricky],
    ["billing fixture", fixture("billing.fixture.csv")],
    ["card-inventory fixture", fixture("card-inventory.fixture.csv")],
    ["header-only file", encode("a,b,c\n")],
    ["empty buffer", new Uint8Array(0)],
  ];

  for (const windowRows of [1, 3, 50_000]) {
    for (const [name, bytes] of inputs) {
      it(`${name} at window size ${windowRows}`, async () => {
        const { rows, windows } = await collect(bytes, windowRows);
        expect(rows).toEqual(wholeFile(bytes));
        for (const w of windows) {
          expect(w.length).toBeGreaterThan(0);
          expect(w.length).toBeLessThanOrEqual(windowRows);
        }
      });
    }
  }

  it("round-trips a >= 3 MiB file with a 4-byte emoji straddling the first 1 MiB slice boundary", async () => {
    const boundary = CSV_SLICE_BYTES;
    const parts: string[] = ["a,b\n"];
    let bytesSoFar = 4;
    while (bytesSoFar + 14 <= boundary - 16) {
      parts.push("filler,filler\n");
      bytesSoFar += 14;
    }
    // Pad so the next line starts at byte (boundary - 4); "e," is 2 bytes, so the
    // emoji occupies bytes boundary-2 .. boundary+1 and is split across the slice edge.
    const padLen = boundary - 4 - bytesSoFar;
    expect(padLen).toBeGreaterThanOrEqual(4);
    parts.push("p," + "x".repeat(padLen - 3) + "\n");
    parts.push("e,\u{1F600}\n");
    const head = parts.join("");
    const emojiStart = Buffer.byteLength(head) - 5;
    expect(emojiStart).toBe(boundary - 2);
    const tailLines: string[] = [];
    let tailBytes = 0;
    while (tailBytes < 2.2 * 1024 * 1024) {
      const line = "t,tail-row-with-padding-0123456789\n";
      tailLines.push(line);
      tailBytes += line.length;
    }
    const bytes = encode(head + tailLines.join(""));
    expect(bytes.length).toBeGreaterThanOrEqual(3 * 1024 * 1024);

    const { rows } = await collect(bytes, 50_000);
    const expected = wholeFile(bytes);
    expect(rows.length).toBe(expected.length);
    expect(rows).toEqual(expected);
    expect(rows.some((r) => r.b === "\u{1F600}")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// processClaimedFile: windowed billing accounting
// ---------------------------------------------------------------------------

const BILLING_HEADER =
  "timestamp,transactionDate,transactionTime,processor,issuerBank,transactionId,tokenReference,authorised,verificationKind,region";

function billingRow(opts: { id: string; day?: string; authorised?: string; region?: string }): string {
  const day = opts.day ?? "2026-08-20";
  return [
    `${day}T10:00:00.0000000Z`,
    day,
    "10:00:00",
    "SYNTHETIC",
    "Synthetic Bank",
    opts.id,
    "tok-abc",
    opts.authorised ?? "True",
    "DCVV",
    opts.region ?? "Unknown",
  ].join(",");
}

/** 13 data rows: 7 in-window (4 unique ids, 3 repeats), 3 pre-window, 3 rejected. */
const MIXED_ROWS = [
  billingRow({ id: "T1" }), // 1  accepted
  billingRow({ id: "T2" }), // 2  accepted
  billingRow({ id: "T3", day: "2026-08-12" }), // 3  excluded (pre-window)
  billingRow({ id: "T1" }), // 4  duplicate of 1 (different window at size 3)
  billingRow({ id: "" }), // 5  rejected: missing transaction id
  billingRow({ id: "T4" }), // 6  accepted
  billingRow({ id: "T5", day: "2026-08-11" }), // 7  excluded
  billingRow({ id: "T2" }), // 8  duplicate of 2
  billingRow({ id: "T6", authorised: "Maybe" }), // 9  rejected: invalid authorised
  billingRow({ id: "T7" }), // 10 accepted
  billingRow({ id: "T4" }), // 11 duplicate of 6
  billingRow({ id: "T8", day: "2026-08-01" }), // 12 excluded
  billingRow({ id: "T9", region: "" }), // 13 rejected: missing region
];
const MIXED_BYTES = encode([BILLING_HEADER, ...MIXED_ROWS].join("\n") + "\n");

type Counts = {
  accepted: number;
  duplicates: number;
  rejected: number;
  excluded: number;
  rejectReasons: RejectedRow[];
};

interface Harness {
  deps: IngestDeps;
  finalizeCalls: { id: string; status: string; counts: Counts }[];
}

/** Fake deps whose upsertRows de-duplicates on the conflict column across calls, as the DB would. */
function makeDeps(): Harness {
  const seen = new Set<string>();
  const finalizeCalls: Harness["finalizeCalls"] = [];
  const deps: IngestDeps = {
    async findFileByHash() {
      return null;
    },
    async recordFile() {
      return "file-1";
    },
    async upsertVerifications() {
      return 0;
    },
    async upsertRows(_table, rows, opts) {
      let inserted = 0;
      for (const row of rows) {
        const key = String(row[opts.onConflict]);
        if (!seen.has(key)) {
          seen.add(key);
          inserted++;
        }
      }
      return inserted;
    },
    async finalizeFile(id, counts) {
      finalizeCalls.push({
        id,
        status: counts.status,
        counts: {
          accepted: counts.accepted,
          duplicates: counts.duplicates,
          rejected: counts.rejected,
          excluded: counts.excluded,
          rejectReasons: counts.rejectReasons,
        },
      });
    },
  };
  return { deps, finalizeCalls };
}

/** Whole-file reference computed with the handler's own parse/validate/normalise/upsert. */
async function wholeFileReference(bytes: Uint8Array): Promise<Counts & { parsed: number }> {
  const { deps } = makeDeps();
  const { rawRows } = await billingHandler.parse(bytes, "billing-report.csv");
  const { valid, rejected } = billingHandler.validate(rawRows);
  const { rows, excludedPreWindow } = billingHandler.normalise(valid);
  const inserted = await billingHandler.upsert(deps, rows);
  return {
    accepted: inserted,
    duplicates: rows.length - inserted,
    rejected: rejected.length,
    excluded: excludedPreWindow,
    rejectReasons: rejected,
    parsed: rawRows.length,
  };
}

const claimFor = (bytes: Uint8Array): ClaimedFile => ({
  ingestedFileId: "file-1",
  reportType: "billing",
  bytes,
  fileName: "billing-report_2026-08-20.csv",
});

describe("processClaimedFile windowed billing is identical to whole-file processing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the reference itself has the expected shape (guards the fixture)", async () => {
    const ref = await wholeFileReference(MIXED_BYTES);
    expect(ref).toMatchObject({ accepted: 4, duplicates: 3, rejected: 3, excluded: 3, parsed: 13 });
    expect(ref.rejectReasons.map((r) => r.row)).toEqual([5, 9, 13]);
  });

  for (const windowRows of [1, 3, 50_000]) {
    it(`matches whole-file accepted/duplicates/rejected/excluded/rejectReasons at window size ${windowRows}`, async () => {
      const ref = await wholeFileReference(MIXED_BYTES);
      const { deps, finalizeCalls } = makeDeps();
      const result = await processClaimedFile(claimFor(MIXED_BYTES), deps, { windowRows });

      expect(result.accepted).toBe(ref.accepted);
      expect(result.duplicates).toBe(ref.duplicates);
      expect(result.rejected).toBe(ref.rejected);
      expect(result.excluded).toBe(ref.excluded);
      // Whole-file row numbers, not per-window ones.
      expect(result.rejectReasons).toEqual(ref.rejectReasons);
      expect(result.accepted + result.duplicates + result.rejected + result.excluded).toBe(ref.parsed);
      expect(result.reportType).toBe("billing");
      expect(result.ingestedFileId).toBe("file-1");

      expect(finalizeCalls).toHaveLength(1);
      expect(finalizeCalls[0].status).toBe("done");
      expect(finalizeCalls[0].counts).toEqual({
        accepted: ref.accepted,
        duplicates: ref.duplicates,
        rejected: ref.rejected,
        excluded: ref.excluded,
        rejectReasons: ref.rejectReasons,
      });
    });
  }

  it("holds one window at a time: 13 rows at window 3 is exactly 5 upserts of at most 3 rows, and one finalizeFile", async () => {
    const upsertSpy = vi.spyOn(billingHandler, "upsert");
    const { deps, finalizeCalls } = makeDeps();
    await processClaimedFile(claimFor(MIXED_BYTES), deps, { windowRows: 3 });

    expect(upsertSpy).toHaveBeenCalledTimes(5);
    for (const call of upsertSpy.mock.calls) {
      expect(call[1].length).toBeLessThanOrEqual(3);
    }
    expect(finalizeCalls).toHaveLength(1);
  });

  it("finalises failed with the existing missing-column message and upserts nothing when a required column is absent", async () => {
    const bad = encode("timestamp,transactionDate,transactionId\n2026-08-20T10:00:00Z,2026-08-20,T1\n");
    const upsertSpy = vi.spyOn(billingHandler, "upsert");
    const { deps, finalizeCalls } = makeDeps();
    const result = await processClaimedFile(claimFor(bad), deps, { windowRows: 3 });

    expect(result.accepted).toBe(0);
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(finalizeCalls).toHaveLength(1);
    expect(finalizeCalls[0].status).toBe("failed");
    expect(result.rejectReasons[0].reasons[0]).toMatch(/billing report is missing expected column\(s\)/);
  });

  it("non-billing report types still take the whole-file path (one upsert for the whole file)", async () => {
    const dcvv = fixture("dcvv.fixture.csv");
    const { deps, finalizeCalls } = makeDeps();
    const upsertRowsSpy = vi.spyOn(deps, "upsertRows");
    const result = await processClaimedFile(
      { ingestedFileId: "file-1", reportType: "dcvv", bytes: dcvv, fileName: "daily-dcvv-report.csv" },
      deps,
      { windowRows: 1 }
    );
    expect(result.reportType).toBe("dcvv");
    expect(finalizeCalls).toHaveLength(1);
    expect(upsertRowsSpy.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
