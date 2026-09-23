import { describe, expect, it } from "vitest";

import {
  FILTER_REJECTED_MESSAGE,
  UPLOAD_FAILED_MESSAGE,
  batchToastTone,
  describeIngestFailure,
  formatBatchFileCounts,
  formatBatchProgress,
  formatBatchRowCounts,
  formatBatchSummary,
  formatZoneErrorMessage,
  summariseBatch,
  type BatchFileOutcome,
} from "../batch";
import type { IngestionResult } from "@/lib/ingestion/types";

/** Builds an `IngestionResult` fixture by hand — this module must not import
 * anything from `lib/ingestion/` at runtime, only its types. */
function importedResult(overrides: Partial<IngestionResult> = {}): IngestionResult {
  return {
    reportType: "verification",
    accepted: 10,
    duplicates: 1,
    rejected: 0,
    excluded: 0,
    rejectReasons: [],
    ingestedFileId: "file-1",
    ...overrides,
  };
}

function resultOutcome(
  fileName: string,
  result: Partial<IngestionResult> = {}
): BatchFileOutcome {
  return { fileName, kind: "result", result: importedResult(result) };
}

function failedOutcome(fileName: string, message = UPLOAD_FAILED_MESSAGE): BatchFileOutcome {
  return { fileName, kind: "failed", message };
}

function skippedOutcome(fileName: string, message = FILTER_REJECTED_MESSAGE): BatchFileOutcome {
  return { fileName, kind: "skipped", message };
}

describe("summariseBatch", () => {
  it("returns every field at 0 for an empty array", () => {
    expect(summariseBatch([])).toEqual({
      files: 0,
      imported: 0,
      alreadyUploaded: 0,
      unrecognised: 0,
      failed: 0,
      skipped: 0,
      accepted: 0,
      duplicates: 0,
      rejected: 0,
      excluded: 0,
    });
  });

  it("classifies each kind into exactly one file bucket, and files equals the sum of all buckets", () => {
    const outcomes: BatchFileOutcome[] = [
      resultOutcome("a.csv"),
      resultOutcome("b.csv", { alreadyUploaded: { date: "2026-09-20T00:00:00Z" } }),
      resultOutcome("c.csv", { reportType: null, accepted: 0, duplicates: 0, rejected: 0 }),
      failedOutcome("d.csv"),
      skippedOutcome("e.txt"),
    ];

    const totals = summariseBatch(outcomes);

    expect(totals.files).toBe(5);
    expect(totals.imported).toBe(1);
    expect(totals.alreadyUploaded).toBe(1);
    expect(totals.unrecognised).toBe(1);
    expect(totals.failed).toBe(1);
    expect(totals.skipped).toBe(1);
    expect(
      totals.imported +
        totals.alreadyUploaded +
        totals.unrecognised +
        totals.failed +
        totals.skipped
    ).toBe(totals.files);
  });

  it("sums row counts over kind 'result' outcomes only — a 'failed' or 'skipped' outcome contributes none", () => {
    const outcomes: BatchFileOutcome[] = [
      resultOutcome("a.csv", { accepted: 10, duplicates: 2, rejected: 1, excluded: 3 }),
      resultOutcome("b.csv", { accepted: 5, duplicates: 0, rejected: 0, excluded: 0 }),
      failedOutcome("c.csv"),
      skippedOutcome("d.txt"),
    ];

    const totals = summariseBatch(outcomes);

    expect(totals.accepted).toBe(15);
    expect(totals.duplicates).toBe(2);
    expect(totals.rejected).toBe(1);
    expect(totals.excluded).toBe(3);
  });

  it("counts a result with alreadyUploaded set as alreadyUploaded, not imported, even when reportType is non-null", () => {
    const totals = summariseBatch([
      resultOutcome("a.csv", {
        reportType: "billing",
        alreadyUploaded: { date: "2026-09-20T00:00:00Z" },
      }),
    ]);

    expect(totals.alreadyUploaded).toBe(1);
    expect(totals.imported).toBe(0);
  });

  it("counts a result with reportType null and no alreadyUploaded as unrecognised", () => {
    const totals = summariseBatch([
      resultOutcome("a.csv", { reportType: null, accepted: 0, duplicates: 0, rejected: 0 }),
    ]);

    expect(totals.unrecognised).toBe(1);
    expect(totals.imported).toBe(0);
  });
});

describe("describeIngestFailure", () => {
  it("returns the mapped copy for 401, 400 and 413", () => {
    expect(describeIngestFailure(401)).toBe(
      "Your session has expired. Sign in again, then upload this file."
    );
    expect(describeIngestFailure(400)).toBe(
      "The server didn't receive this file. Try adding it again."
    );
    expect(describeIngestFailure(413)).toBe(
      "File too large. Report files should be at most a few MB."
    );
  });

  it("returns UPLOAD_FAILED_MESSAGE for 500 and for an unmapped status such as 502", () => {
    expect(describeIngestFailure(500)).toBe(UPLOAD_FAILED_MESSAGE);
    expect(describeIngestFailure(502)).toBe(UPLOAD_FAILED_MESSAGE);
  });
});

describe("formatBatchFileCounts", () => {
  it("always names the imported count and omits the other four clauses when they are 0", () => {
    const totals = summariseBatch([resultOutcome("a.csv"), resultOutcome("b.csv")]);
    expect(formatBatchFileCounts(totals)).toBe("2 files imported.");
  });

  it("says '1 file' (not '1 files') for a single-file batch", () => {
    const totals = summariseBatch([resultOutcome("a.csv")]);
    expect(formatBatchFileCounts(totals)).toBe("1 file imported.");
  });

  it("includes every non-zero clause", () => {
    const totals = summariseBatch([
      resultOutcome("a.csv"),
      resultOutcome("b.csv", { alreadyUploaded: { date: "2026-09-20T00:00:00Z" } }),
      resultOutcome("c.csv", { reportType: null, accepted: 0, duplicates: 0, rejected: 0 }),
      failedOutcome("d.csv"),
      skippedOutcome("e.txt"),
    ]);
    expect(formatBatchFileCounts(totals)).toBe(
      "1 file imported, 1 already uploaded, 1 unrecognised, 1 failed, 1 filtered out."
    );
  });
});

describe("formatBatchRowCounts", () => {
  it("returns null when imported is 0", () => {
    const totals = summariseBatch([failedOutcome("a.csv"), skippedOutcome("b.txt")]);
    expect(formatBatchRowCounts(totals)).toBeNull();
  });

  it("appends the excluded clause only when excluded is greater than 0", () => {
    const withoutExcluded = summariseBatch([
      resultOutcome("a.csv", { accepted: 10, duplicates: 1, rejected: 0, excluded: 0 }),
    ]);
    expect(formatBatchRowCounts(withoutExcluded)).toBe(
      "10 rows accepted · 1 duplicates skipped · 0 rejected."
    );

    const withExcluded = summariseBatch([
      resultOutcome("a.csv", { accepted: 10, duplicates: 1, rejected: 0, excluded: 5 }),
    ]);
    expect(formatBatchRowCounts(withExcluded)).toBe(
      "10 rows accepted · 1 duplicates skipped · 0 rejected · 5 excluded (before 13 Aug 2026 data window)."
    );
  });

  it("formats every number with toLocaleString('en-GB')", () => {
    const totals = summariseBatch([
      resultOutcome("a.csv", { accepted: 1450, duplicates: 2000, rejected: 3, excluded: 0 }),
    ]);
    expect(formatBatchRowCounts(totals)).toBe(
      "1,450 rows accepted · 2,000 duplicates skipped · 3 rejected."
    );
  });
});

describe("formatBatchSummary", () => {
  it("joins the file-count sentence with the row-count sentence when one exists", () => {
    const totals = summariseBatch([resultOutcome("a.csv", { accepted: 10, duplicates: 1 })]);
    expect(formatBatchSummary(totals)).toBe(
      "1 file imported. 10 rows accepted · 1 duplicates skipped · 0 rejected."
    );
  });

  it("is the file-count sentence alone when formatBatchRowCounts returns null", () => {
    const totals = summariseBatch([failedOutcome("a.csv")]);
    expect(formatBatchSummary(totals)).toBe("0 files imported, 1 failed.");
  });

  it("pins the exact summary string for a 25-outcome mixed batch", () => {
    const imported: BatchFileOutcome[] = Array.from({ length: 14 }, (_, i) =>
      resultOutcome(`imported-${i}.csv`, {
        accepted: 100,
        duplicates: 2,
        rejected: 1,
        excluded: 0,
      })
    );
    imported.push(
      resultOutcome("imported-14.csv", {
        accepted: 50,
        duplicates: 0,
        rejected: 0,
        excluded: 20,
      })
    );

    const outcomes: BatchFileOutcome[] = [
      ...imported, // 15 imported
      resultOutcome("dup-1.csv", {
        alreadyUploaded: { date: "2026-09-20T00:00:00Z" },
        accepted: 0,
        duplicates: 0,
        rejected: 0,
      }),
      resultOutcome("dup-2.csv", {
        alreadyUploaded: { date: "2026-09-20T00:00:00Z" },
        accepted: 0,
        duplicates: 0,
        rejected: 0,
      }),
      resultOutcome("dup-3.csv", {
        alreadyUploaded: { date: "2026-09-20T00:00:00Z" },
        accepted: 0,
        duplicates: 0,
        rejected: 0,
      }),
      resultOutcome("unknown-1.pdf", {
        reportType: null,
        accepted: 0,
        duplicates: 0,
        rejected: 0,
      }),
      resultOutcome("unknown-2.pdf", {
        reportType: null,
        accepted: 0,
        duplicates: 0,
        rejected: 0,
      }),
      failedOutcome("failed-1.xlsx"),
      failedOutcome("failed-2.xlsx"),
      failedOutcome("failed-3.xlsx"),
      skippedOutcome("skipped-1.pdf"),
      skippedOutcome("skipped-2.doc"),
    ];

    expect(outcomes).toHaveLength(25);

    const totals = summariseBatch(outcomes);
    expect(totals.files).toBe(25);

    expect(formatBatchSummary(totals)).toBe(
      "15 files imported, 3 already uploaded, 2 unrecognised, 3 failed, 2 filtered out. " +
        "1,450 rows accepted · 28 duplicates skipped · 14 rejected · 20 excluded (before 13 Aug 2026 data window)."
    );
  });
});

describe("formatBatchProgress", () => {
  it("formats the pinned progress copy", () => {
    expect(formatBatchProgress(3, 25, "x.xlsx")).toBe(
      "Uploading and processing file 3 of 25 — x.xlsx"
    );
  });
});

describe("formatZoneErrorMessage", () => {
  it("returns the single-file copy when files === 1", () => {
    const totals = summariseBatch([failedOutcome("a.csv")]);
    expect(formatZoneErrorMessage(totals)).toBe(
      "This file couldn't be processed. The details are below."
    );
  });

  it("returns the multi-file copy otherwise", () => {
    const totals = summariseBatch([failedOutcome("a.csv"), failedOutcome("b.csv")]);
    expect(formatZoneErrorMessage(totals)).toBe(
      "None of the files could be processed. The details for each file are below."
    );
  });
});

describe("batchToastTone", () => {
  it("returns 'error' when failed + unrecognised + skipped is greater than 0", () => {
    const totals = summariseBatch([resultOutcome("a.csv"), failedOutcome("b.csv")]);
    expect(batchToastTone(totals)).toBe("error");
  });

  it("returns 'info' when there are no problems but nothing was imported", () => {
    const totals = summariseBatch([
      resultOutcome("a.csv", { alreadyUploaded: { date: "2026-09-20T00:00:00Z" } }),
    ]);
    expect(batchToastTone(totals)).toBe("info");
  });

  it("returns 'success' otherwise", () => {
    const totals = summariseBatch([resultOutcome("a.csv")]);
    expect(batchToastTone(totals)).toBe("success");
  });

  it("gives the error condition priority over the empty-import condition", () => {
    const totals = summariseBatch([
      resultOutcome("a.csv", { reportType: null, accepted: 0, duplicates: 0, rejected: 0 }),
    ]);
    expect(totals.imported).toBe(0);
    expect(batchToastTone(totals)).toBe("error");
  });
});
