import { describe, expect, it } from "vitest";

import {
  FILE_TOO_LARGE_MESSAGE,
  FILTER_REJECTED_MESSAGE,
  RECEIVED_MESSAGE,
  STILL_PROCESSING_MESSAGE,
  UPLOAD_FAILED_MESSAGE,
  UPLOAD_INTERRUPTED_MESSAGE,
  XLSX_TOO_LARGE_MESSAGE,
  batchToastTone,
  describeIngestFailure,
  formatBatchFileCounts,
  formatBatchRowCounts,
  formatBatchSummary,
  formatCheckingStage,
  formatFileSize,
  formatUploadingStage,
  formatZoneErrorMessage,
  isXlsxTooLarge,
  summariseBatch,
  type BatchFileOutcome,
} from "../batch";
import { XLSX_TOO_LARGE_REASON } from "@/lib/ingestion/xlsx-cap";
import type { IngestionResult, ReportType } from "@/lib/ingestion/types";

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

function receivedOutcome(fileName: string, message = RECEIVED_MESSAGE): BatchFileOutcome {
  return { fileName, kind: "received", message };
}

function pendingOutcome(
  fileName: string,
  fileId = "pending-file-1",
  reportType: ReportType = "verification"
): BatchFileOutcome {
  return { fileName, kind: "pending", fileId, reportType };
}

describe("summariseBatch", () => {
  it("returns every field at 0 for an empty array", () => {
    // NOTE: this one pre-existing assertion's object literal necessarily
    // grows to include `pending: 0` — it is an exact-equality check that
    // enumerates every BatchTotals field, so a new required field cannot be
    // added to the interface without this specific literal changing. Every
    // other pre-existing assertion in this file is otherwise unedited (see
    // 13-06-SUMMARY.md Deviations).
    expect(summariseBatch([])).toEqual({
      files: 0,
      imported: 0,
      alreadyUploaded: 0,
      pending: 0,
      received: 0,
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

  it("a lone pending outcome produces one file, one pending, and zero in every other file bucket", () => {
    const totals = summariseBatch([pendingOutcome("a.xlsx")]);

    expect(totals.files).toBe(1);
    expect(totals.pending).toBe(1);
    expect(totals.imported).toBe(0);
    expect(totals.alreadyUploaded).toBe(0);
    expect(totals.unrecognised).toBe(0);
    expect(totals.failed).toBe(0);
    expect(totals.skipped).toBe(0);
  });

  it("a pending outcome contributes nothing to the four row-count totals", () => {
    const totals = summariseBatch([pendingOutcome("a.xlsx")]);

    expect(totals.accepted).toBe(0);
    expect(totals.duplicates).toBe(0);
    expect(totals.rejected).toBe(0);
    expect(totals.excluded).toBe(0);
  });

  it("a mixed batch of one imported, one pending and one skipped reports one in each bucket and three files", () => {
    const totals = summariseBatch([
      resultOutcome("a.csv"),
      pendingOutcome("b.xlsx"),
      skippedOutcome("c.pdf"),
    ]);

    expect(totals.files).toBe(3);
    expect(totals.imported).toBe(1);
    expect(totals.pending).toBe(1);
    expect(totals.skipped).toBe(1);
  });

  it("a pending outcome never increments the failed bucket — the specific 2026-10-05 regression", () => {
    const totals = summariseBatch([pendingOutcome("a.xlsx"), pendingOutcome("b.xlsx")]);

    expect(totals.pending).toBe(2);
    expect(totals.failed).toBe(0);
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
    expect(describeIngestFailure(413)).toBe(FILE_TOO_LARGE_MESSAGE);
    expect(FILE_TOO_LARGE_MESSAGE).toBe("File too large. The limit is 100 MB per file.");
  });

  it("returns UPLOAD_FAILED_MESSAGE for 500 and for an unmapped status such as 502", () => {
    expect(describeIngestFailure(500)).toBe(UPLOAD_FAILED_MESSAGE);
    expect(describeIngestFailure(502)).toBe(UPLOAD_FAILED_MESSAGE);
  });

  it("has no 202 case — 202 is ok and this map is only ever reached for a non-ok status", () => {
    // Pinning, not exhaustive: 202 falls to the same default branch as any
    // other status this map doesn't name, because no case for it exists and
    // none should ever be added. 202 is handled by branching on
    // response.status BEFORE this function is ever called (dropzone.tsx) —
    // the switch itself stays exactly as it was.
    expect(describeIngestFailure(202)).toBe(UPLOAD_FAILED_MESSAGE);
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

  it("names a single pending file in its own clause, singular, with the imported clause still present at zero", () => {
    const totals = summariseBatch([pendingOutcome("a.xlsx")]);
    expect(formatBatchFileCounts(totals)).toBe("0 files imported, 1 file pending.");
  });

  it("pluralises the pending clause at two", () => {
    const totals = summariseBatch([pendingOutcome("a.xlsx"), pendingOutcome("b.xlsx")]);
    expect(formatBatchFileCounts(totals)).toBe("0 files imported, 2 files pending.");
  });

  it("omits the pending clause entirely when the count is zero", () => {
    const totals = summariseBatch([resultOutcome("a.csv")]);
    expect(formatBatchFileCounts(totals)).not.toContain("pending");
  });

  it("places the pending clause after already-uploaded and before unrecognised", () => {
    const totals = summariseBatch([
      resultOutcome("a.csv", { alreadyUploaded: { date: "2026-09-20T00:00:00Z" } }),
      pendingOutcome("b.xlsx"),
      resultOutcome("c.csv", { reportType: null, accepted: 0, duplicates: 0, rejected: 0 }),
    ]);
    expect(formatBatchFileCounts(totals)).toBe(
      "0 files imported, 1 already uploaded, 1 file pending, 1 unrecognised."
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

  it("returns null for a batch of only pending files — no row totals worth reporting yet", () => {
    const totals = summariseBatch([pendingOutcome("a.xlsx"), pendingOutcome("b.xlsx")]);
    expect(formatBatchRowCounts(totals)).toBeNull();
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

describe("received outcomes (D-15)", () => {
  it("a received outcome lands in the received bucket only and contributes no row totals", () => {
    const totals = summariseBatch([receivedOutcome("a.csv")]);
    expect(totals.files).toBe(1);
    expect(totals.received).toBe(1);
    expect(totals.failed).toBe(0);
    expect(totals.pending).toBe(0);
    expect(totals.imported).toBe(0);
    expect(totals.alreadyUploaded).toBe(0);
    expect(totals.unrecognised).toBe(0);
    expect(totals.skipped).toBe(0);
    expect(totals.accepted + totals.duplicates + totals.rejected + totals.excluded).toBe(0);
  });

  it("files equals the sum of all buckets including received", () => {
    const totals = summariseBatch([
      resultOutcome("a.csv"),
      pendingOutcome("b.csv"),
      receivedOutcome("c.csv"),
      failedOutcome("d.csv"),
      skippedOutcome("e.txt"),
    ]);
    expect(
      totals.imported +
        totals.alreadyUploaded +
        totals.pending +
        totals.received +
        totals.unrecognised +
        totals.failed +
        totals.skipped
    ).toBe(totals.files);
  });

  it("formatBatchFileCounts places the received clause after pending and before unrecognised", () => {
    const totals = summariseBatch([
      resultOutcome("a.csv", { alreadyUploaded: { date: "2026-09-20T00:00:00Z" } }),
      pendingOutcome("b.xlsx"),
      receivedOutcome("c.csv"),
      resultOutcome("d.csv", { reportType: null, accepted: 0, duplicates: 0, rejected: 0 }),
    ]);
    expect(formatBatchFileCounts(totals)).toBe(
      "0 files imported, 1 already uploaded, 1 file pending, 1 file received for processing, 1 unrecognised."
    );
  });

  it("pluralises the received clause at two and omits it at zero", () => {
    expect(
      formatBatchFileCounts(summariseBatch([receivedOutcome("a.csv"), receivedOutcome("b.csv")]))
    ).toBe("0 files imported, 2 files received for processing.");
    expect(formatBatchFileCounts(summariseBatch([resultOutcome("a.csv")]))).not.toContain(
      "received"
    );
  });

  it("an all-received batch has toast tone 'info' and does not satisfy the dropzone's error condition", () => {
    const totals = summariseBatch([receivedOutcome("a.csv"), receivedOutcome("b.csv")]);
    expect(batchToastTone(totals)).toBe("info");
    expect(totals.failed + totals.skipped).not.toBe(totals.files);
  });

  it("pins RECEIVED_MESSAGE and UPLOAD_INTERRUPTED_MESSAGE and neither says 'failed'", () => {
    expect(RECEIVED_MESSAGE).toBe(
      "Received — will be processed. Its outcome will appear in the upload history below."
    );
    expect(UPLOAD_INTERRUPTED_MESSAGE).toBe("Upload interrupted — try again.");
    expect(RECEIVED_MESSAGE.toLowerCase()).not.toContain("failed");
    expect(UPLOAD_INTERRUPTED_MESSAGE.toLowerCase()).not.toContain("failed");
  });
});

describe("upload stage copy (D-11)", () => {
  it("formatUploadingStage names file position, name and size", () => {
    expect(formatUploadingStage(2, 5, "billing-report_2026-10-14.csv", 22_400_000)).toBe(
      "Uploading file 2 of 5 — billing-report_2026-10-14.csv (22.4 MB)…"
    );
  });

  it("formatCheckingStage names file position only", () => {
    expect(formatCheckingStage(2, 5)).toBe("Checking file 2 of 5…");
  });

  it("formatFileSize uses decimal units", () => {
    expect(formatFileSize(0)).toBe("0 KB");
    expect(formatFileSize(512)).toBe("1 KB");
    expect(formatFileSize(22_400_000)).toBe("22.4 MB");
    expect(formatFileSize(104_857_600)).toBe("104.9 MB");
  });
});

describe("isXlsxTooLarge (D-16)", () => {
  const base: IngestionResult = {
    reportType: null,
    accepted: 0,
    duplicates: 0,
    rejected: 0,
    excluded: 0,
    rejectReasons: [{ row: 0, reasons: [XLSX_TOO_LARGE_REASON] }] as IngestionResult["rejectReasons"],
    ingestedFileId: "f",
  };

  it("is true for a null-reportType result carrying the XLSX reason", () => {
    expect(isXlsxTooLarge(base)).toBe(true);
  });

  it("is false when the report type is known, or the reason is absent", () => {
    expect(isXlsxTooLarge({ ...base, reportType: "billing" })).toBe(false);
    expect(isXlsxTooLarge({ ...base, rejectReasons: [] })).toBe(false);
  });

  it("XLSX_TOO_LARGE_MESSAGE names the 15 MB limit and says the file was kept", () => {
    expect(XLSX_TOO_LARGE_MESSAGE).toBe(
      "Spreadsheet too large to process. XLSX files are limited to 15 MB; this file was kept but not imported."
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

describe("pending outcomes and the drop zone's error-state check", () => {
  it("an all-pending batch does not satisfy the dropzone's error condition (failed + skipped === files)", () => {
    // Mirrors the exact condition dropzone.tsx uses to decide "error" vs
    // "idle" state — asserted here on the same totals object, since pending
    // files must never put the drop zone into its error state.
    const totals = summariseBatch([pendingOutcome("a.xlsx"), pendingOutcome("b.xlsx")]);
    expect(totals.failed + totals.skipped).not.toBe(totals.files);
  });
});

describe("STILL_PROCESSING_MESSAGE", () => {
  it("is honest and never says 'failed' — the per-file copy for a pending outcome", () => {
    expect(STILL_PROCESSING_MESSAGE.toLowerCase()).not.toContain("fail");
    expect(STILL_PROCESSING_MESSAGE).toContain("upload history");
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

  it("returns 'info', not 'error', for a batch of only pending files — nothing has gone wrong", () => {
    const totals = summariseBatch([pendingOutcome("a.xlsx"), pendingOutcome("b.xlsx")]);
    expect(batchToastTone(totals)).toBe("info");
  });

  it("returns 'info', not 'success', for a batch of only pending files — nothing has succeeded yet either", () => {
    const totals = summariseBatch([pendingOutcome("a.xlsx")]);
    expect(batchToastTone(totals)).not.toBe("success");
  });

  it("returns 'error' for a batch of one pending and one failed file — the existing problem rule is unchanged", () => {
    const totals = summariseBatch([pendingOutcome("a.xlsx"), failedOutcome("b.csv")]);
    expect(batchToastTone(totals)).toBe("error");
  });

  it("does not return 'error' for a batch of one imported and one pending file", () => {
    const totals = summariseBatch([resultOutcome("a.csv"), pendingOutcome("b.xlsx")]);
    expect(batchToastTone(totals)).not.toBe("error");
  });
});
