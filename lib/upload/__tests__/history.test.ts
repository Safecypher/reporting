import { describe, expect, it } from "vitest";

import {
  DELIVERY_REJECTED_STATUS_LABEL,
  FAILED_STATUS_LABEL,
  REJECTED_STATUS,
  formatCount,
  mergeHistory,
  sourceLabel,
  type IngestedFileRow,
  type RejectionRow,
} from "../history";

function upload(overrides: Partial<IngestedFileRow> = {}): IngestedFileRow {
  return {
    id: "upload-1",
    file_name: "verification.csv",
    uploaded_at: "2026-09-25T06:00:00.000Z",
    uploaded_by: null,
    status: "done",
    rows_accepted: 10,
    rows_duplicate: 1,
    rows_rejected: 0,
    source: "manual",
    source_ref: null,
    push_credentials: null,
    ...overrides,
  };
}

function rejection(overrides: Partial<RejectionRow> = {}): RejectionRow {
  return {
    id: "rejection-1",
    sender: "TSYS",
    file_name: "empty.csv",
    reason: "Empty file. This file has no content and was not accepted.",
    rejected_at: "2026-09-25T06:00:00.000Z",
    ...overrides,
  };
}

describe("sourceLabel", () => {
  it("returns the sender name verbatim for a pushed file", () => {
    expect(sourceLabel({ kind: "push", senderName: "TSYS" })).toBe("TSYS");
  });

  it("returns the sender name verbatim for a rejection", () => {
    expect(sourceLabel({ kind: "rejection", senderName: "Bit Addict" })).toBe("Bit Addict");
  });

  it("prefixes a manual upload with the uploader's email", () => {
    expect(sourceLabel({ kind: "manual", uploaderEmail: "mark.wright@safecypher.com" })).toBe(
      "Manual — mark.wright@safecypher.com"
    );
  });

  it("falls back to 'Manual — unknown user' when the identity cannot be resolved", () => {
    expect(sourceLabel({ kind: "manual", uploaderEmail: null })).toBe("Manual — unknown user");
  });
});

describe("formatCount", () => {
  it("renders an em dash for null", () => {
    expect(formatCount(null)).toBe("—");
  });

  it("renders an em dash for undefined", () => {
    expect(formatCount(undefined)).toBe("—");
  });

  it("renders a genuine zero as the number, not the dash", () => {
    expect(formatCount(0)).toBe("0");
  });

  it("renders a positive count as its number", () => {
    expect(formatCount(1234)).toBe("1,234");
  });
});

describe("mergeHistory", () => {
  it("interleaves three uploads and two rejections into one correctly ordered list", () => {
    const uploads = [
      upload({ id: "u1", uploaded_at: "2026-09-25T08:00:00.000Z" }),
      upload({ id: "u2", uploaded_at: "2026-09-25T06:00:00.000Z" }),
      upload({ id: "u3", uploaded_at: "2026-09-25T04:00:00.000Z" }),
    ];
    const rejections = [
      rejection({ id: "r1", rejected_at: "2026-09-25T07:00:00.000Z" }),
      rejection({ id: "r2", rejected_at: "2026-09-25T05:00:00.000Z" }),
    ];

    const merged = mergeHistory(uploads, rejections);

    expect(merged.map((row) => row.id)).toEqual(["u1", "r1", "u2", "r2", "u3"]);
  });

  it("tie-breaks a shared timestamp deterministically: kind (upload before rejection) then id ascending, stable across a reversed input order", () => {
    const uploads = [upload({ id: "u2", uploaded_at: "2026-09-25T06:00:00.000Z" })];
    const rejections = [rejection({ id: "r1", rejected_at: "2026-09-25T06:00:00.000Z" })];

    const forward = mergeHistory(uploads, rejections);
    const reversed = mergeHistory([...uploads], [...rejections].reverse());

    expect(forward.map((row) => row.id)).toEqual(["u2", "r1"]);
    expect(reversed.map((row) => row.id)).toEqual(["u2", "r1"]);
  });

  it("tie-breaks two same-kind rows sharing a timestamp by id ascending", () => {
    const uploads = [
      upload({ id: "u9", uploaded_at: "2026-09-25T06:00:00.000Z" }),
      upload({ id: "u2", uploaded_at: "2026-09-25T06:00:00.000Z" }),
    ];

    const merged = mergeHistory(uploads, []);

    expect(merged.map((row) => row.id)).toEqual(["u2", "u9"]);
  });

  it("returns a non-empty list when there are zero uploads and one or more rejections", () => {
    const merged = mergeHistory([], [rejection()]);

    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe("rejection");
  });

  it("returns an empty list when both inputs are empty", () => {
    expect(mergeHistory([], [])).toEqual([]);
  });

  it("derives the Source column from the sender for a pushed upload", () => {
    const merged = mergeHistory(
      [
        upload({
          id: "u1",
          source: "push",
          push_credentials: { sender: "TSYS" },
        }),
      ],
      []
    );

    expect(merged[0].source).toBe("TSYS");
  });

  it("derives the Source column as 'Manual — unknown user' for a manual upload", () => {
    const merged = mergeHistory([upload({ id: "u1", source: "manual" })], []);

    expect(merged[0].source).toBe("Manual — unknown user");
  });

  it("derives the Source column from the rejection's own denormalised sender", () => {
    const merged = mergeHistory([], [rejection({ sender: "Bit Addict" })]);

    expect(merged[0].source).toBe("Bit Addict");
  });

  it("gives a rejection row no counts and no source reference", () => {
    const merged = mergeHistory([], [rejection()]);

    expect(merged[0].accepted).toBeNull();
    expect(merged[0].duplicate).toBeNull();
    expect(merged[0].rejected).toBeNull();
    expect(merged[0].sourceRef).toBeNull();
    expect(merged[0].status).toBe(REJECTED_STATUS);
    expect(merged[0].reason).toBe(rejection().reason);
  });

  it("carries the upload's source_ref through untouched", () => {
    const merged = mergeHistory(
      [upload({ id: "u1", source: "push", source_ref: "inbox/tsys/123-file.csv" })],
      []
    );

    expect(merged[0].sourceRef).toBe("inbox/tsys/123-file.csv");
  });
});

describe("status label constants", () => {
  it("are distinct, non-empty exported strings", () => {
    expect(FAILED_STATUS_LABEL).toBe("Failed");
    expect(DELIVERY_REJECTED_STATUS_LABEL).toBe("Delivery rejected");
    expect(FAILED_STATUS_LABEL).not.toBe(DELIVERY_REJECTED_STATUS_LABEL);
  });
});
